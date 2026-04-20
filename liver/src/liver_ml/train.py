"""数据划分、多模型训练、5 折交叉验证与 Stacking。"""
from __future__ import annotations

import json
import os
import warnings

import joblib
import numpy as np
import pandas as pd
from catboost import CatBoostClassifier
from lightgbm import LGBMClassifier
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, StackingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, LogisticRegressionCV
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

from .config import (
    CAP_COL,
    CAP_NAFLD_THRESHOLD,
    CATEGORICAL_FEATURES,
    DATA_CSV,
    FEATURE_SET,
    FIG_DIR,
    LIVERDISEASE_CSV,
    MODEL_DIR,
    NUMERIC_FEATURES,
    OUTPUT_DIR,
    PA_BINARY,
    RANDOM_STATE,
    REPORT_DIR,
    STROKE_METABOLISM_CSV,
    USE_ITERATIVE_IMPUTER,
)
from .dashboard import build_dashboard_html
from .eda import run_eda
from .feature_display import write_column_mapping_csv
from .metrics_tools import classification_metrics
from .plot_eval import (
    blend_with_platt,
    confidence_bucket_table,
    expected_calibration_error,
    plot_logistic_l1_coefficient_path,
    plot_lasso_cv_curve,
    plot_reliability_diagram,
    plot_roc_curves_multi,
)
from .preprocess import build_feature_matrix, full_preprocess, replace_sentinels
from .risk import compare_tier_methods, health_score_from_prob, kmeans_high_risk_subtypes, risk_method_prob
from .shap_tools import compute_tree_local_shap_topk, fit_tree_explainer_on_training, run_shap_summary

warnings.filterwarnings("ignore", category=UserWarning)


def _as_float64(X):
    return np.asarray(X, dtype=np.float64)


def make_preprocess_tree(numeric_cols: list[str], categorical_cols: list[str]) -> ColumnTransformer:
    """数值列保留 NaN 供树模型；类别列缺失→missing 后 One-Hot。"""
    try:
        num_tf = FunctionTransformer(
            _as_float64,
            validate=False,
            feature_names_out="one-to-one",
        )
    except TypeError:
        num_tf = FunctionTransformer(_as_float64, validate=False)
    return ColumnTransformer(
        transformers=[
            ("num", num_tf, numeric_cols),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imp", SimpleImputer(strategy="constant", fill_value="missing")),
                        (
                            "ohe",
                            OneHotEncoder(handle_unknown="ignore", sparse_output=False, max_categories=30),
                        ),
                    ]
                ),
                categorical_cols,
            ),
        ],
        remainder="drop",
    )


def make_preprocess_median(numeric_cols: list[str], categorical_cols: list[str]) -> ColumnTransformer:
    """中位数 / 众数插补 + Z-score（用于 LR、RF、MLP）。"""
    return ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_cols,
            ),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "ohe",
                            OneHotEncoder(handle_unknown="ignore", sparse_output=False, max_categories=25),
                        ),
                    ]
                ),
                categorical_cols,
            ),
        ],
        remainder="drop",
    )


def make_preprocess_iterative(numeric_cols: list[str], categorical_cols: list[str]) -> ColumnTransformer:
    """IterativeImputer + 随机森林（近似 missForest）+ Z-score。"""
    from sklearn.experimental import enable_iterative_imputer  # noqa: F401
    from sklearn.impute import IterativeImputer

    est = RandomForestRegressor(
        n_estimators=40,
        max_depth=10,
        random_state=RANDOM_STATE,
        n_jobs=1,
        max_features="sqrt",
    )
    return ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    steps=[
                        (
                            "imputer",
                            IterativeImputer(
                                estimator=est,
                                max_iter=8,
                                random_state=RANDOM_STATE,
                            ),
                        ),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_cols,
            ),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "ohe",
                            OneHotEncoder(handle_unknown="ignore", sparse_output=False, max_categories=25),
                        ),
                    ]
                ),
                categorical_cols,
            ),
        ],
        remainder="drop",
    )


def make_linear_preprocess(numeric_cols: list[str], categorical_cols: list[str]) -> ColumnTransformer:
    if USE_ITERATIVE_IMPUTER:
        return make_preprocess_iterative(numeric_cols, categorical_cols)
    return make_preprocess_median(numeric_cols, categorical_cols)


def _feature_name_to_raw(name: str, cat_cols: list[str]) -> str:
    if name.startswith("num__"):
        return name.split("__", 1)[1]
    if name.startswith("cat__"):
        payload = name.split("__", 1)[1]
        for col in sorted(cat_cols, key=len, reverse=True):
            prefix = f"{col}_"
            if payload == col or payload.startswith(prefix):
                return col
        return payload
    return name


def run_lasso_feature_selection(
    preprocess_linear: ColumnTransformer,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    cat_cols: list[str],
) -> tuple[dict, LogisticRegressionCV]:
    model = LogisticRegressionCV(
        Cs=20,
        cv=5,
        penalty="l1",
        solver="saga",
        scoring="roc_auc",
        class_weight="balanced",
        max_iter=5000,
        random_state=RANDOM_STATE,
        n_jobs=1,
        refit=True,
    )
    model.fit(preprocess_linear.transform(X_train), y_train)

    p_val = model.predict_proba(preprocess_linear.transform(X_val))[:, 1]
    p_test = model.predict_proba(preprocess_linear.transform(X_test))[:, 1]
    metrics = {
        "val": classification_metrics(y_val, p_val, auc_ci=True),
        "test": classification_metrics(y_test, p_test, auc_ci=True),
    }

    fn = preprocess_linear.get_feature_names_out()
    coef = model.coef_.ravel()
    mask = np.abs(coef) > 1e-8
    selected = pd.DataFrame(
        {
            "feature_name": fn,
            "raw_feature": [_feature_name_to_raw(name, cat_cols) for name in fn],
            "coefficient": coef,
            "abs_coefficient": np.abs(coef),
            "selected": mask.astype(int),
        }
    ).sort_values(["selected", "abs_coefficient"], ascending=[False, False])
    selected.to_csv(REPORT_DIR / "lasso_selected_transformed_features.csv", index=False)

    raw_selected = (
        selected.loc[selected["selected"] == 1]
        .groupby("raw_feature", as_index=False)
        .agg(
            n_selected_terms=("feature_name", "count"),
            max_abs_coefficient=("abs_coefficient", "max"),
        )
        .sort_values(["max_abs_coefficient", "n_selected_terms"], ascending=[False, False])
    )
    raw_selected.to_csv(REPORT_DIR / "lasso_selected_raw_features.csv", index=False)
    return metrics, model


def train_all():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    df_raw, y, _ = full_preprocess(
        DATA_CSV,
        liver_path=LIVERDISEASE_CSV,
        stroke_path=STROKE_METABOLISM_CSV,
    )
    df_raw = replace_sentinels(df_raw)

    X, num_cols, cat_cols = build_feature_matrix(
        df_raw,
        NUMERIC_FEATURES,
        CATEGORICAL_FEATURES,
        PA_BINARY,
    )
    y = y.loc[X.index]

    for c in ["RIDAGEYR", "RIAGENDR", "BMXBMI"]:
        if c in X.columns:
            m = X[c].notna()
            if c in num_cols:
                m &= pd.to_numeric(X[c], errors="coerce").notna()
            X, y = X.loc[m], y.loc[m]

    print(f"样本量（清洗后）: {len(X)}, 正例率(NAFLD CAP≥{CAP_NAFLD_THRESHOLD}): {y.mean():.4f}")

    write_column_mapping_csv(num_cols, cat_cols, REPORT_DIR / "feature_name_mapping.csv")

    run_eda(X, y, num_cols, FIG_DIR)

    # 70 / 15 / 15；SEQN 唯一时与行级分层等价
    X_trainval, X_test, y_trainval, y_test = train_test_split(
        X,
        y,
        test_size=0.15,
        stratify=y,
        random_state=RANDOM_STATE,
    )
    val_ratio = 0.15 / (1.0 - 0.15)
    X_train, X_val, y_train, y_val = train_test_split(
        X_trainval,
        y_trainval,
        test_size=val_ratio,
        stratify=y_trainval,
        random_state=RANDOM_STATE,
    )

    preprocess_linear = make_linear_preprocess(num_cols, cat_cols)
    preprocess_tree = make_preprocess_tree(num_cols, cat_cols)

    X_tr_lin = preprocess_linear.fit_transform(X_train)
    X_va_lin = preprocess_linear.transform(X_val)
    X_te_lin = preprocess_linear.transform(X_test)

    X_tr_tree = preprocess_tree.fit_transform(X_train)
    X_va_tree = preprocess_tree.transform(X_val)
    X_te_tree = preprocess_tree.transform(X_test)

    pos = (y_train == 1).sum()
    neg = (y_train == 0).sum()
    spw = neg / max(pos, 1)

    linear_models = {
        "LR": LogisticRegression(
            max_iter=3000,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            solver="lbfgs",
        ),
        "LASSO": LogisticRegression(
            max_iter=5000,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            solver="saga",
            penalty="l1",
            C=0.1,
        ),
        "RF": RandomForestClassifier(
            n_estimators=400,
            max_depth=12,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            n_jobs=1,
        ),
        "MLP": MLPClassifier(
            hidden_layer_sizes=(128, 64),
            max_iter=400,
            random_state=RANDOM_STATE,
            early_stopping=True,
            validation_fraction=0.1,
        ),
    }

    tree_models = {
        "XGB": XGBClassifier(
            n_estimators=400,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            scale_pos_weight=spw,
            random_state=RANDOM_STATE,
            eval_metric="auc",
            verbosity=0,
            n_jobs=1,
        ),
        "LGBM": LGBMClassifier(
            n_estimators=500,
            max_depth=-1,
            learning_rate=0.05,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            verbose=-1,
            n_jobs=1,
        ),
        "CatBoost": CatBoostClassifier(
            depth=6,
            iterations=500,
            learning_rate=0.05,
            auto_class_weights="Balanced",
            random_seed=RANDOM_STATE,
            verbose=False,
        ),
    }

    results = {}
    fitted = {}
    tabular_preds_val: dict[str, np.ndarray] = {}
    tabular_preds_test: dict[str, np.ndarray] = {}

    for name, clf in linear_models.items():
        clf.fit(X_tr_lin, y_train)
        p_va = clf.predict_proba(X_va_lin)[:, 1]
        p_te = clf.predict_proba(X_te_lin)[:, 1]
        fitted[name] = clf
        tabular_preds_val[name] = np.asarray(p_va, dtype=float)
        tabular_preds_test[name] = np.asarray(p_te, dtype=float)
        results[name] = {
            "val": classification_metrics(y_val, p_va, auc_ci=True),
            "test": classification_metrics(y_test, p_te, auc_ci=True),
        }

    lasso_cv_metrics, lasso_cv_model = run_lasso_feature_selection(
        preprocess_linear,
        X_train,
        y_train,
        X_val,
        y_val,
        X_test,
        y_test,
        cat_cols,
    )
    fitted["LASSO_CV"] = lasso_cv_model
    results["LASSO_CV"] = lasso_cv_metrics
    p_va_lcv = lasso_cv_model.predict_proba(preprocess_linear.transform(X_val))[:, 1]
    p_te_lcv = lasso_cv_model.predict_proba(preprocess_linear.transform(X_test))[:, 1]
    tabular_preds_val["LASSO_CV"] = np.asarray(p_va_lcv, dtype=float)
    tabular_preds_test["LASSO_CV"] = np.asarray(p_te_lcv, dtype=float)

    try:
        plot_lasso_cv_curve(lasso_cv_model, FIG_DIR / "lasso_logistic_cv_auc_curve.png")
        fn_lin = preprocess_linear.get_feature_names_out()
        plot_logistic_l1_coefficient_path(
            X_tr_lin,
            y_train.to_numpy(),
            fn_lin,
            FIG_DIR / "lasso_l1_coefficient_path.png",
            max_features_plot=22,
            random_state=RANDOM_STATE,
        )
    except Exception as e:
        print("LASSO 可视化跳过:", e)

    for name, clf in tree_models.items():
        clf.fit(X_tr_tree, y_train)
        p_va = clf.predict_proba(X_va_tree)[:, 1]
        p_te = clf.predict_proba(X_te_tree)[:, 1]
        fitted[name] = clf
        tabular_preds_val[name] = np.asarray(p_va, dtype=float)
        tabular_preds_test[name] = np.asarray(p_te, dtype=float)
        results[name] = {
            "val": classification_metrics(y_val, p_va, auc_ci=True),
            "test": classification_metrics(y_test, p_te, auc_ci=True),
        }

    # Stacking：树基学习器 + LR 元学习器（TabTransformer 在 FT 模块单独评估，见 run_meta）
    stack = StackingClassifier(
        estimators=[
            ("xgb", Pipeline([("prep", clone(preprocess_tree)), ("clf", clone(tree_models["XGB"]))])),
            ("lgbm", Pipeline([("prep", clone(preprocess_tree)), ("clf", clone(tree_models["LGBM"]))])),
            ("cat", Pipeline([("prep", clone(preprocess_tree)), ("clf", clone(tree_models["CatBoost"]))])),
        ],
        final_estimator=LogisticRegression(max_iter=2000, class_weight="balanced"),
        cv=5,
        stack_method="predict_proba",
        n_jobs=1,
    )
    stack.fit(X_train, y_train)
    p_va_s = stack.predict_proba(X_val)[:, 1]
    p_te_s = stack.predict_proba(X_test)[:, 1]
    fitted["Stacking"] = stack
    tabular_preds_val["Stacking"] = np.asarray(p_va_s, dtype=float)
    tabular_preds_test["Stacking"] = np.asarray(p_te_s, dtype=float)
    results["Stacking"] = {
        "val": classification_metrics(y_val, p_va_s, auc_ci=True),
        "test": classification_metrics(y_test, p_te_s, auc_ci=True),
    }

    # 5 折 CV（训练集 OOF）
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    cv_rows = []
    for name, clf in linear_models.items():
        pipe = Pipeline([("prep", clone(preprocess_linear)), ("clf", clone(clf))])
        pred = cross_val_predict(
            pipe,
            X_train,
            y_train,
            cv=skf,
            method="predict_proba",
            n_jobs=1,
        )[:, 1]
        auc = roc_auc_score(y_train, pred) if len(np.unique(y_train)) > 1 else np.nan
        cv_rows.append({"model": name, "cv_train_auc_oof": auc, "pipeline": "linear"})

    for name, clf in tree_models.items():
        pipe = Pipeline([("prep", clone(preprocess_tree)), ("clf", clone(clf))])
        pred = cross_val_predict(
            pipe,
            X_train,
            y_train,
            cv=skf,
            method="predict_proba",
            n_jobs=1,
        )[:, 1]
        auc = roc_auc_score(y_train, pred) if len(np.unique(y_train)) > 1 else np.nan
        cv_rows.append({"model": name, "cv_train_auc_oof": auc, "pipeline": "tree_nan"})

    repeat_summary = []
    for seed in [RANDOM_STATE, RANDOM_STATE + 7, RANDOM_STATE + 13]:
        Xa, Xb, ya, yb = train_test_split(X, y, test_size=0.15, stratify=y, random_state=seed)
        Xtr, Xva, ytr, yva = train_test_split(Xa, ya, test_size=0.15 / 0.85, stratify=ya, random_state=seed)
        pre = make_preprocess_tree(num_cols, cat_cols)
        Xtr_m = pre.fit_transform(Xtr)
        Xva_m = pre.transform(Xva)
        xgb = XGBClassifier(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            scale_pos_weight=(ytr == 0).sum() / max((ytr == 1).sum(), 1),
            random_state=seed,
            eval_metric="auc",
            verbosity=0,
        )
        xgb.fit(Xtr_m, ytr)
        p = xgb.predict_proba(Xva_m)[:, 1]
        repeat_summary.append(
            {
                "seed": seed,
                "xgb_val_auc": roc_auc_score(yva, p) if len(np.unique(yva)) > 1 else np.nan,
            }
        )

    tree_flat = []
    for m in ["XGB", "LGBM", "CatBoost"]:
        r = results[m]
        row = {"model": m, "pipeline": "tree_nan"}
        for split in ("val", "test"):
            for k, v in r[split].items():
                row[f"{split}_{k}"] = v
        tree_flat.append(row)
    pd.DataFrame(tree_flat).to_csv(REPORT_DIR / "metrics_tree_nan.csv", index=False)
    joblib.dump(preprocess_tree, MODEL_DIR / "preprocess_tree_nan.joblib")
    joblib.dump(fitted["XGB"], MODEL_DIR / "xgb_tree_nan.joblib")

    fn_tree = preprocess_tree.get_feature_names_out()
    run_shap_summary(
        X_test,
        preprocess_tree,
        fitted["XGB"],
        np.array(fn_tree),
        output_tag="tree_nan",
        write_top10_text=False,
    )

    try:
        import torch

        from .ft_transformer import evaluate_ft_test, train_ft_transformer

        ft_info, ft_model, ft_enc, ft_med = train_ft_transformer(
            X_train,
            X_val,
            y_train,
            y_val,
            num_cols,
            cat_cols,
            epochs=35,
        )
        ft_info["epoch_confidence_log"].to_csv(REPORT_DIR / "ft_transformer_epoch_confidence.csv", index=False)
        te_ft, p_te_ft = evaluate_ft_test(
            ft_model,
            ft_enc,
            ft_med,
            X_test,
            y_test,
            num_cols,
            cat_cols,
            ft_info["device"],
        )
        tabular_preds_val["FTTransformer"] = np.asarray(ft_info["val_probs"], dtype=float)
        tabular_preds_test["FTTransformer"] = np.asarray(p_te_ft, dtype=float)
        row_ft: dict = {"model": "FTTransformer", "pipeline": "torch"}
        for k, v in ft_info["val"].items():
            row_ft[f"val_{k}"] = v
        for k, v in te_ft.items():
            row_ft[f"test_{k}"] = v
        pd.DataFrame([row_ft]).to_csv(REPORT_DIR / "metrics_ft_transformer.csv", index=False)
        torch.save(
            {
                "state_dict": ft_model.state_dict(),
                "n_num": ft_model.n_num,
                "n_cat": ft_model.n_cat,
                "card_sizes": [e.num_embeddings for e in ft_model.cat_emb],
            },
            MODEL_DIR / "ft_transformer.pt",
        )
        joblib.dump(ft_enc, MODEL_DIR / "ft_ordinal_encoder.joblib")
        joblib.dump(ft_med, MODEL_DIR / "ft_num_medians.joblib")
        joblib.dump({"num_cols": num_cols, "cat_cols": cat_cols}, MODEL_DIR / "ft_columns.joblib")
    except Exception as e:
        print("FT-Transformer 跳过:", e)

    joblib.dump(preprocess_linear, MODEL_DIR / "preprocess.joblib")
    joblib.dump(fitted["XGB"], MODEL_DIR / "xgb_model.joblib")
    joblib.dump(fitted["Stacking"], MODEL_DIR / "stacking_model.joblib")
    joblib.dump(fitted["LASSO_CV"], MODEL_DIR / "lasso_cv_model.joblib")

    p_test_xgb = fitted["XGB"].predict_proba(X_te_tree)[:, 1]
    run_shap_summary(X_test, preprocess_tree, fitted["XGB"], np.array(fn_tree))

    # 个体 SHAP（训练集拟合解释器 -> 测试集抽样逐样本 TOP5；可通过环境变量关闭）
    enable_personalized_shap = os.getenv("LIVER_ENABLE_PERSONALIZED_SHAP", "1").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    if enable_personalized_shap:
        top_k = int(os.getenv("LIVER_SHAP_TOPK", "5"))
        validate_n = int(os.getenv("LIVER_SHAP_VALIDATE_N", "80"))
        background_n = int(os.getenv("LIVER_SHAP_BACKGROUND_N", "200"))

        n_sel = int(min(max(validate_n, 1), len(X_test)))
        rng = np.random.RandomState(RANDOM_STATE)
        if n_sel < len(X_test):
            idx_sel = rng.choice(len(X_test), n_sel, replace=False)
        else:
            idx_sel = np.arange(len(X_test))

        # 1) 在训练集上拟合解释器
        explainer, background_X_t = fit_tree_explainer_on_training(
            X_train=X_train,
            preprocess=preprocess_tree,
            model=fitted["XGB"],
            max_background=background_n,
            random_state=RANDOM_STATE,
        )
        joblib.dump(background_X_t, MODEL_DIR / "shap_tree_background_t.joblib")

        # 2) 测试集抽样计算本地 SHAP
        X_test_sel = X_test.iloc[idx_sel]
        y_test_sel = y_test.iloc[idx_sel].to_numpy(dtype=int)
        p_sel = p_test_xgb[idx_sel].astype(float)

        local_top_df = compute_tree_local_shap_topk(
            X=X_test_sel,
            preprocess=preprocess_tree,
            explainer=explainer,
            feature_names_after_transform=np.array(fn_tree),
            top_k=top_k,
            y_true=y_test_sel,
            p_nafld=p_sel,
        )
        local_top_df["health_score"] = health_score_from_prob(p_sel)
        local_top_df.to_csv(
            REPORT_DIR / f"tabular_personalized_shap_top{top_k}_test_sample.csv",
            index=False,
            encoding="utf-8-sig",
        )

        # 3) 抽样验证：健康评分对“非 NAFLD”分组的一致性 + TOP 特征方向一致性
        non_nafld = (1 - y_test_sel).astype(int)
        if len(np.unique(non_nafld)) > 1:
            health_auc = roc_auc_score(non_nafld, local_top_df["health_score"].to_numpy(dtype=float))
        else:
            health_auc = float("nan")

        mean_health_non = float(np.nanmean(local_top_df.loc[y_test_sel == 0, "health_score"].to_numpy(dtype=float)))
        mean_health_nafld = float(np.nanmean(local_top_df.loc[y_test_sel == 1, "health_score"].to_numpy(dtype=float)))

        shap_cols = [f"top{r}_shap" for r in range(1, top_k + 1)]
        indicators = []
        for c in shap_cols:
            if c not in local_top_df.columns:
                continue
            v = local_top_df[c].to_numpy(dtype=float)
            ind = np.where(np.isnan(v), np.nan, (v > 0).astype(float))
            indicators.append(ind)
        if indicators:
            # 每个样本的“TOP 特征中，指向 NAFLD 的方向为正”的比例
            sample_pos_rate = np.nanmean(np.stack(indicators, axis=0), axis=0)
            pos_rate_non = float(np.nanmean(sample_pos_rate[y_test_sel == 0]))
            pos_rate_nafld = float(np.nanmean(sample_pos_rate[y_test_sel == 1]))
        else:
            pos_rate_non = float("nan")
            pos_rate_nafld = float("nan")

        validation = {
            "n_selected": n_sel,
            "top_k": top_k,
            "health_score_formula": "health=(1-p_nafld)*100",
            "health_auc_predict_non_nafld": health_auc,
            "mean_health_non_nafld": mean_health_non,
            "mean_health_nafld": mean_health_nafld,
            "shap_direction_check_top_features_positive_share": {
                "pos_rate_top_shap_gt_0_among_topk_non_nafld": pos_rate_non,
                "pos_rate_top_shap_gt_0_among_topk_nafld": pos_rate_nafld,
            },
            "note": "仅用于抽样探索：本地 SHAP 方向性与标签之间应出现趋势（非严格因果）。",
        }
        (REPORT_DIR / f"tabular_personalized_shap_validation_top{top_k}.json").write_text(
            json.dumps(validation, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    df_tier = risk_method_prob(y_test, p_test_xgb)
    df_km = kmeans_high_risk_subtypes(X_test, p_test_xgb)
    compare_tier_methods(df_tier, df_km)

    y_val_np = y_val.to_numpy()
    y_test_np = y_test.to_numpy()
    gentle_mix = 0.32
    try:
        roc_items = [(k, y_test_np, v) for k, v in sorted(tabular_preds_test.items())]
        plot_roc_curves_multi(
            roc_items,
            FIG_DIR / "roc_curve_tabular_test_all_models.png",
            "表格模型：测试集 ROC 曲线",
        )
    except Exception as e:
        print("表格 ROC 汇总图跳过:", e)

    calib_rows = []
    for m in ["LR", "LASSO_CV", "RF", "MLP", "XGB", "LGBM", "CatBoost", "Stacking", "FTTransformer"]:
        if m not in tabular_preds_val or m not in tabular_preds_test:
            continue
        pv = tabular_preds_val[m]
        pt = tabular_preds_test[m]
        pt_g, _ = blend_with_platt(y_val_np, pv, pt, gentle_mix)
        calib_rows.append(
            {
                "model": m,
                "gentle_platt_mix": gentle_mix,
                "val_ece": expected_calibration_error(y_val_np, pv),
                "test_ece_raw": expected_calibration_error(y_test_np, pt),
                "test_ece_gentle": expected_calibration_error(y_test_np, pt_g),
                "test_brier_raw": float(brier_score_loss(y_test_np, pt)),
                "test_brier_gentle": float(brier_score_loss(y_test_np, pt_g)),
                "test_auc_raw": float(roc_auc_score(y_test_np, pt)) if len(np.unique(y_test_np)) > 1 else np.nan,
                "test_auc_gentle": float(roc_auc_score(y_test_np, pt_g)) if len(np.unique(y_test_np)) > 1 else np.nan,
            }
        )
    if calib_rows:
        pd.DataFrame(calib_rows).to_csv(REPORT_DIR / "confidence_calibration_tabular.csv", index=False)

    try:
        if "XGB" in tabular_preds_test:
            plot_reliability_diagram(
                y_test_np,
                tabular_preds_test["XGB"],
                FIG_DIR / "reliability_xgb_test_raw.png",
                "可靠性图：XGB 测试集（未校准）",
            )
            if "XGB" in tabular_preds_val:
                pt_g, _ = blend_with_platt(
                    y_val_np,
                    tabular_preds_val["XGB"],
                    tabular_preds_test["XGB"],
                    gentle_mix,
                )
                plot_reliability_diagram(
                    y_test_np,
                    pt_g,
                    FIG_DIR / "reliability_xgb_test_gentle_platt.png",
                    f"可靠性图：XGB 测试集（温和 Platt 混合 mix={gentle_mix}）",
                )
    except Exception as e:
        print("可靠性图跳过:", e)

    try:
        for m in ["LR", "XGB", "Stacking"]:
            if m not in tabular_preds_test:
                continue
            confidence_bucket_table(y_test_np, tabular_preds_test[m], n_bins=10).to_csv(
                REPORT_DIR / f"confidence_buckets_{m}_test.csv",
                index=False,
            )
    except Exception as e:
        print("置信度分箱表跳过:", e)

    flat = []
    for m, r in results.items():
        row = {"model": m}
        for split in ("val", "test"):
            for k, v in r[split].items():
                row[f"{split}_{k}"] = v
        flat.append(row)
    out_df = pd.DataFrame(flat)
    out_df.to_csv(REPORT_DIR / "metrics_all_models.csv", index=False)
    pd.DataFrame(cv_rows).to_csv(REPORT_DIR / "cv_5fold_oof.csv", index=False)
    pd.DataFrame(repeat_summary).to_csv(REPORT_DIR / "repeated_split_xgb.csv", index=False)

    meta = {
        "outcome": f"NAFLD: {CAP_COL} >= {CAP_NAFLD_THRESHOLD} dB/m",
        "n_total": int(len(X)),
        "n_train": int(len(y_train)),
        "n_val": int(len(y_val)),
        "n_test": int(len(y_test)),
        "pos_rate": float(y.mean()),
        "numeric_features": num_cols,
        "categorical_features": cat_cols,
        "feature_set": FEATURE_SET,
        "liverdisease_merged": LIVERDISEASE_CSV.exists(),
        "liverdisease_path": str(LIVERDISEASE_CSV),
        "stroke_metabolism_merged": STROKE_METABOLISM_CSV.exists(),
        "stroke_metabolism_path": str(STROKE_METABOLISM_CSV),
        "imputer_linear": "iterative_rf_missforest_like" if USE_ITERATIVE_IMPUTER else "median_mfreq_ohe",
        "stacking_note": "基学习器为 XGB+LGBM+CatBoost（树+NaN）；TabTransformer 见 metrics_ft_transformer.csv，未并入 sklearn Stacking 以降低计算与兼容成本。",
        "split_note": "70/15/15 分层；SEQN 唯一时与行级划分等价。",
        "calibration_note": "confidence_calibration_tabular.csv：验证集拟合 Platt 后与原始概率做凸组合（默认 mix=0.32），小样本下仅作探索；若 ECE 改善有限或 AUC 波动可忽略。",
        "ft_confidence_note": "ft_transformer_epoch_confidence.csv：每轮验证集 AUC 与按真实标签分组的平均预测概率、平均熵，用于训练过程置信度走势。",
    }
    (REPORT_DIR / "run_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    print(out_df.to_string(index=False))
    try:
        build_dashboard_html()
    except Exception as e:
        print("Plotly 仪表板生成跳过:", e)

    return preprocess_linear, fitted, X_test, y_test, num_cols, cat_cols, p_test_xgb


if __name__ == "__main__":
    train_all()
