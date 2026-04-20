from __future__ import annotations

import copy
import json
import math
import re
import warnings
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.model_selection import train_test_split
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision import models, transforms

from .config import OUTPUT_DIR, RANDOM_STATE, REPORT_DIR
from .risk import health_score_from_prob
from .metrics_tools import classification_metrics
from .plot_eval import blend_with_platt, plot_roc_curve, plot_roc_curves_multi
from .yolo_model import build_yolo_seg_binary, is_yolo_seg_model

warnings.filterwarnings("ignore", category=UserWarning)

IMAGE_ROOT = Path(__file__).resolve().parents[2] / "data" / "image" / "B-MODE"
IMAGE_OUTPUT_DIR = OUTPUT_DIR / "image"
IMAGE_MODEL_DIR = OUTPUT_DIR / "models" / "image"
IMAGE_REPORT_DIR = REPORT_DIR / "image"
IMAGE_FIG_DIR = OUTPUT_DIR / "figures" / "image"

PATTERN = re.compile(r"(?P<patient_id>patient_\d+)_slice_(?P<slice_id>\d+)$")
CLASS_TO_LABEL = {"Non-NAFLD": 0, "NAFLD": 1}


@dataclass
class ImageTrainConfig:
    data_dir: Path = IMAGE_ROOT
    output_root: Path = OUTPUT_DIR
    image_size: int = 224
    batch_size: int = 16
    epochs: int = 12
    lr: float = 1e-4
    weight_decay: float = 1e-4
    num_workers: int = 0
    train_ratio: float = 0.70
    val_ratio: float = 0.15
    test_ratio: float = 0.15
    min_epoch_samples: int = 1024
    early_stopping_patience: int = 4
    threshold: float = 0.5
    random_state: int = RANDOM_STATE
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
    models: tuple[str, ...] = (
        "simple_cnn",
        "resnet50",
        "efficientnet_b0",
        "densenet121",
        "vit_b_16",
        "yolo11s_seg",
        "yolo8s_seg",
    )


def resolve_output_paths(output_root: Path) -> tuple[Path, Path, Path]:
    output_root = Path(output_root)
    return (
        output_root / "image",
        output_root / "models" / "image",
        output_root / "reports" / "image",
    )


class UltrasoundDataset(Dataset):
    def __init__(self, frame: pd.DataFrame, transform=None) -> None:
        self.frame = frame.reset_index(drop=True).copy()
        self.transform = transform

    def __len__(self) -> int:
        return len(self.frame)

    def __getitem__(self, index: int) -> dict:
        row = self.frame.iloc[index]
        image = Image.open(row["path"]).convert("RGB")
        if self.transform is not None:
            image = self.transform(image)
        return {
            "image": image,
            "label": torch.tensor(int(row["label"]), dtype=torch.float32),
            "patient_id": row["patient_id"],
            "slice_id": int(row["slice_id"]),
            "path": str(row["path"]),
        }


class SimpleCNN(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(128, 256, kernel_size=3, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(1),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.30),
            nn.Linear(256, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.20),
            nn.Linear(64, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.classifier(x)
        return x.squeeze(1)


def _safe_model_builder(builder, weight_enum):
    try:
        return builder(weights=weight_enum)
    except Exception:
        return builder(weights=None)


def build_model(model_name: str) -> nn.Module:
    if model_name == "simple_cnn":
        return SimpleCNN()
    if model_name == "resnet50":
        model = _safe_model_builder(models.resnet50, models.ResNet50_Weights.DEFAULT)
        model.fc = nn.Linear(model.fc.in_features, 1)
        return model
    if model_name == "efficientnet_b0":
        model = _safe_model_builder(models.efficientnet_b0, models.EfficientNet_B0_Weights.DEFAULT)
        model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, 1)
        return model
    if model_name == "densenet121":
        model = _safe_model_builder(models.densenet121, models.DenseNet121_Weights.DEFAULT)
        model.classifier = nn.Linear(model.classifier.in_features, 1)
        return model
    if model_name == "vit_b_16":
        model = _safe_model_builder(models.vit_b_16, models.ViT_B_16_Weights.DEFAULT)
        model.heads.head = nn.Linear(model.heads.head.in_features, 1)
        return model
    if is_yolo_seg_model(model_name):
        return build_yolo_seg_binary(model_name)
    raise ValueError(f"Unsupported model: {model_name}")


def build_transforms(image_size: int) -> tuple[transforms.Compose, transforms.Compose]:
    train_tf = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.RandomVerticalFlip(p=0.2),
            transforms.RandomRotation(degrees=12),
            transforms.ColorJitter(brightness=0.20, contrast=0.20),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    eval_tf = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    return train_tf, eval_tf


def scan_image_dataset(data_dir: Path) -> pd.DataFrame:
    rows: list[dict] = []
    for class_name, label in CLASS_TO_LABEL.items():
        class_dir = data_dir / class_name
        if not class_dir.exists():
            continue
        for path in sorted(class_dir.glob("*")):
            if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".bmp"}:
                continue
            match = PATTERN.match(path.stem)
            if match is None:
                raise ValueError(f"Cannot parse patient/slice id from {path.name}")
            rows.append(
                {
                    "path": path.resolve(),
                    "class_name": class_name,
                    "label": label,
                    "patient_id": match.group("patient_id"),
                    "slice_id": int(match.group("slice_id")),
                    "filename": path.name,
                }
            )
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise FileNotFoundError(f"No images found under {data_dir}")
    return frame.sort_values(["patient_id", "slice_id"]).reset_index(drop=True)


def stratified_group_split(frame: pd.DataFrame, config: ImageTrainConfig) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    patient_df = (
        frame.groupby("patient_id", as_index=False)
        .agg(label=("label", "first"), class_name=("class_name", "first"), n_slices=("path", "count"))
        .sort_values("patient_id")
    )
    train_val_patients, test_patients = train_test_split(
        patient_df,
        test_size=config.test_ratio,
        stratify=patient_df["label"],
        random_state=config.random_state,
    )
    val_share = config.val_ratio / (config.train_ratio + config.val_ratio)
    train_patients, val_patients = train_test_split(
        train_val_patients,
        test_size=val_share,
        stratify=train_val_patients["label"],
        random_state=config.random_state,
    )

    split_map = {}
    split_map.update({pid: "train" for pid in train_patients["patient_id"]})
    split_map.update({pid: "val" for pid in val_patients["patient_id"]})
    split_map.update({pid: "test" for pid in test_patients["patient_id"]})

    out = frame.copy()
    out["split"] = out["patient_id"].map(split_map)
    return (
        out.loc[out["split"] == "train"].reset_index(drop=True),
        out.loc[out["split"] == "val"].reset_index(drop=True),
        out.loc[out["split"] == "test"].reset_index(drop=True),
    )


def create_train_sampler(train_df: pd.DataFrame, min_epoch_samples: int, random_state: int) -> WeightedRandomSampler:
    class_counts = train_df["label"].value_counts().to_dict()
    weights = train_df["label"].map(lambda x: 1.0 / class_counts[int(x)]).astype(float).to_numpy()
    samples_per_epoch = max(int(min_epoch_samples), len(train_df))
    generator = torch.Generator()
    generator.manual_seed(random_state)
    return WeightedRandomSampler(
        weights=torch.as_tensor(weights, dtype=torch.double),
        num_samples=samples_per_epoch,
        replacement=True,
        generator=generator,
    )


def build_dataloaders(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    test_df: pd.DataFrame,
    config: ImageTrainConfig,
) -> dict[str, DataLoader]:
    train_tf, eval_tf = build_transforms(config.image_size)
    train_ds = UltrasoundDataset(train_df, transform=train_tf)
    val_ds = UltrasoundDataset(val_df, transform=eval_tf)
    test_ds = UltrasoundDataset(test_df, transform=eval_tf)
    sampler = create_train_sampler(train_df, config.min_epoch_samples, config.random_state)
    return {
        "train": DataLoader(
            train_ds,
            batch_size=config.batch_size,
            sampler=sampler,
            num_workers=config.num_workers,
            pin_memory=(config.device == "cuda"),
        ),
        "val": DataLoader(
            val_ds,
            batch_size=config.batch_size,
            shuffle=False,
            num_workers=config.num_workers,
            pin_memory=(config.device == "cuda"),
        ),
        "test": DataLoader(
            test_ds,
            batch_size=config.batch_size,
            shuffle=False,
            num_workers=config.num_workers,
            pin_memory=(config.device == "cuda"),
        ),
    }


def run_epoch(model, loader, criterion, optimizer, device: str) -> dict[str, float]:
    model.train()
    total_loss = 0.0
    total_items = 0
    for batch in loader:
        images = batch["image"].to(device)
        labels = batch["label"].to(device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(images).reshape(-1)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()
        batch_size = labels.shape[0]
        total_loss += float(loss.item()) * batch_size
        total_items += batch_size
    return {"loss": total_loss / max(total_items, 1)}


@torch.no_grad()
def predict_loader(model, loader, device: str) -> pd.DataFrame:
    model.eval()
    rows: list[dict] = []
    for batch in loader:
        images = batch["image"].to(device)
        logits = model(images).reshape(-1)
        probs = torch.sigmoid(logits).cpu().numpy()
        labels = batch["label"].cpu().numpy().astype(int)
        for idx, prob in enumerate(probs):
            rows.append(
                {
                    "path": batch["path"][idx],
                    "patient_id": batch["patient_id"][idx],
                    "slice_id": int(batch["slice_id"][idx]),
                    "label": int(labels[idx]),
                    "prob": float(prob),
                }
            )
    return pd.DataFrame(rows)


def summarize_predictions(pred_df: pd.DataFrame, threshold: float) -> tuple[dict, pd.DataFrame]:
    metrics = classification_metrics(pred_df["label"], pred_df["prob"], threshold=threshold, auc_ci=True)
    metrics["f1_macro"] = f1_score(pred_df["label"], pred_df["prob"] >= threshold, average="macro", zero_division=0)
    metrics["f1_weighted"] = f1_score(
        pred_df["label"],
        pred_df["prob"] >= threshold,
        average="weighted",
        zero_division=0,
    )
    patient_df = (
        pred_df.groupby("patient_id", as_index=False)
        .agg(label=("label", "first"), prob=("prob", "mean"), n_slices=("slice_id", "count"))
        .sort_values("patient_id")
    )
    patient_metrics = classification_metrics(patient_df["label"], patient_df["prob"], threshold=threshold, auc_ci=False)
    patient_metrics["f1_macro"] = f1_score(
        patient_df["label"],
        patient_df["prob"] >= threshold,
        average="macro",
        zero_division=0,
    )
    patient_metrics["f1_weighted"] = f1_score(
        patient_df["label"],
        patient_df["prob"] >= threshold,
        average="weighted",
        zero_division=0,
    )
    return {"slice_level": metrics, "patient_level": patient_metrics}, patient_df


def fit_calibrators(y_true: np.ndarray, y_prob: np.ndarray) -> dict[str, object]:
    eps = 1e-6
    clipped = np.clip(y_prob, eps, 1 - eps)
    logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)

    platt = LogisticRegression(max_iter=1000)
    platt.fit(logits, y_true)
    isotonic = IsotonicRegression(out_of_bounds="clip")
    isotonic.fit(y_prob, y_true)
    return {"platt": platt, "isotonic": isotonic}


def apply_calibrator(calibrators: dict[str, object], name: str, y_prob: np.ndarray) -> np.ndarray:
    eps = 1e-6
    if name == "platt":
        clipped = np.clip(y_prob, eps, 1 - eps)
        logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
        return calibrators["platt"].predict_proba(logits)[:, 1]
    if name == "isotonic":
        return calibrators["isotonic"].predict(y_prob)
    raise ValueError(f"Unknown calibrator: {name}")


def train_single_model(
    model_name: str,
    loaders: dict[str, DataLoader],
    train_df: pd.DataFrame,
    config: ImageTrainConfig,
) -> dict:
    device = config.device
    model = build_model(model_name).to(device)
    pos = int((train_df["label"] == 1).sum())
    neg = int((train_df["label"] == 0).sum())
    pos_weight = torch.tensor([neg / max(pos, 1)], dtype=torch.float32, device=device)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.lr, weight_decay=config.weight_decay)

    best_state = None
    best_val_auc = -math.inf
    patience_left = config.early_stopping_patience
    history: list[dict] = []

    for epoch in range(1, config.epochs + 1):
        train_info = run_epoch(model, loaders["train"], criterion, optimizer, device)
        val_pred = predict_loader(model, loaders["val"], device)
        val_summary, _ = summarize_predictions(val_pred, threshold=config.threshold)
        val_auc = float(val_summary["patient_level"]["auc"])
        history.append(
            {
                "epoch": epoch,
                "train_loss": train_info["loss"],
                "val_slice_auc": float(val_summary["slice_level"]["auc"]),
                "val_patient_auc": val_auc,
                "val_patient_f1_weighted": float(val_summary["patient_level"]["f1_weighted"]),
            }
        )
        improved = val_auc > best_val_auc
        if improved:
            best_val_auc = val_auc
            patience_left = config.early_stopping_patience
            best_state = copy.deepcopy(model.state_dict())
        else:
            patience_left -= 1
            if patience_left <= 0:
                break

    if best_state is None:
        best_state = copy.deepcopy(model.state_dict())
    model.load_state_dict(best_state)

    val_pred = predict_loader(model, loaders["val"], device)
    test_pred = predict_loader(model, loaders["test"], device)
    val_summary, val_patient = summarize_predictions(val_pred, threshold=config.threshold)
    test_summary, test_patient = summarize_predictions(test_pred, threshold=config.threshold)

    calibrators = fit_calibrators(val_patient["label"].to_numpy(), val_patient["prob"].to_numpy())
    calib_rows = []
    gentle_mix = 0.30
    y_va_pt = val_patient["label"].to_numpy()
    p_va_pt = val_patient["prob"].to_numpy()
    p_te_pt = test_patient["prob"].to_numpy()
    p_te_gentle, _ = blend_with_platt(y_va_pt, p_va_pt, p_te_pt, gentle_mix)
    for name in ["platt", "isotonic"]:
        calibrated_test = test_patient.copy()
        calibrated_test["prob"] = apply_calibrator(calibrators, name, calibrated_test["prob"].to_numpy())
        metrics = classification_metrics(
            calibrated_test["label"],
            calibrated_test["prob"],
            threshold=config.threshold,
            auc_ci=False,
        )
        metrics["f1_macro"] = f1_score(
            calibrated_test["label"],
            calibrated_test["prob"] >= config.threshold,
            average="macro",
            zero_division=0,
        )
        metrics["f1_weighted"] = f1_score(
            calibrated_test["label"],
            calibrated_test["prob"] >= config.threshold,
            average="weighted",
            zero_division=0,
        )
        calib_rows.append({"calibration": name, **metrics})
    calibrated_g = test_patient.copy()
    calibrated_g["prob"] = p_te_gentle
    metrics_g = classification_metrics(
        calibrated_g["label"],
        calibrated_g["prob"],
        threshold=config.threshold,
        auc_ci=False,
    )
    metrics_g["f1_macro"] = f1_score(
        calibrated_g["label"],
        calibrated_g["prob"] >= config.threshold,
        average="macro",
        zero_division=0,
    )
    metrics_g["f1_weighted"] = f1_score(
        calibrated_g["label"],
        calibrated_g["prob"] >= config.threshold,
        average="weighted",
        zero_division=0,
    )
    calib_rows.append({"calibration": f"platt_gentle_mix_{gentle_mix}", **metrics_g})

    return {
        "model": model,
        "history": pd.DataFrame(history),
        "val_slice_predictions": val_pred,
        "test_slice_predictions": test_pred,
        "val_patient_predictions": val_patient,
        "test_patient_predictions": test_patient,
        "val_metrics": val_summary,
        "test_metrics": test_summary,
        "test_calibration_metrics": pd.DataFrame(calib_rows),
    }


def write_split_reports(train_df: pd.DataFrame, val_df: pd.DataFrame, test_df: pd.DataFrame, report_dir: Path) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    split_df = pd.concat([train_df, val_df, test_df], ignore_index=True)
    split_df.to_csv(report_dir / "image_split_manifest.csv", index=False)

    patient_summary = (
        split_df.groupby(["split", "class_name"], as_index=False)
        .agg(n_images=("path", "count"), n_patients=("patient_id", "nunique"))
        .sort_values(["split", "class_name"])
    )
    patient_summary.to_csv(report_dir / "image_split_summary.csv", index=False)


def train_image_models(config: ImageTrainConfig | None = None) -> pd.DataFrame:
    config = config or ImageTrainConfig()
    image_output_dir, image_model_dir, image_report_dir = resolve_output_paths(config.output_root)
    image_output_dir.mkdir(parents=True, exist_ok=True)
    image_model_dir.mkdir(parents=True, exist_ok=True)
    image_report_dir.mkdir(parents=True, exist_ok=True)
    image_fig_dir = Path(config.output_root) / "figures" / "image"
    image_fig_dir.mkdir(parents=True, exist_ok=True)

    full_df = scan_image_dataset(config.data_dir)
    train_df, val_df, test_df = stratified_group_split(full_df, config)
    write_split_reports(train_df, val_df, test_df, image_report_dir)

    loaders = build_dataloaders(train_df, val_df, test_df, config)
    leaderboard_rows = []
    roc_patient_curves: list[tuple[str, np.ndarray, np.ndarray]] = []
    run_meta = {
        "config": {k: str(v) if isinstance(v, Path) else v for k, v in asdict(config).items()},
        "dataset": {
            "n_images": int(len(full_df)),
            "n_patients": int(full_df["patient_id"].nunique()),
            "class_counts": full_df["class_name"].value_counts().to_dict(),
            "train_patients": int(train_df["patient_id"].nunique()),
            "val_patients": int(val_df["patient_id"].nunique()),
            "test_patients": int(test_df["patient_id"].nunique()),
        },
    }

    for model_name in config.models:
        result = train_single_model(model_name, loaders, train_df, config)
        torch.save(
            {
                "model_name": model_name,
                "image_size": config.image_size,
                "threshold": config.threshold,
                "state_dict": result["model"].state_dict(),
            },
            image_model_dir / f"{model_name}.pt",
        )

        # 为所有输出概率 CSV 增加健康评分（越高越健康）
        for k in ["val_slice_predictions", "test_slice_predictions", "val_patient_predictions", "test_patient_predictions"]:
            if k in result and "prob" in result[k].columns:
                result[k]["health_score"] = health_score_from_prob(result[k]["prob"].to_numpy(dtype=float))

        result["history"].to_csv(image_report_dir / f"history_{model_name}.csv", index=False)
        result["val_slice_predictions"].to_csv(image_report_dir / f"val_slice_predictions_{model_name}.csv", index=False)
        result["test_slice_predictions"].to_csv(image_report_dir / f"test_slice_predictions_{model_name}.csv", index=False)
        result["val_patient_predictions"].to_csv(image_report_dir / f"val_patient_predictions_{model_name}.csv", index=False)
        result["test_patient_predictions"].to_csv(image_report_dir / f"test_patient_predictions_{model_name}.csv", index=False)
        result["test_calibration_metrics"].to_csv(image_report_dir / f"test_calibration_{model_name}.csv", index=False)

        tp = result["test_patient_predictions"]
        try:
            plot_roc_curve(
                tp["label"].to_numpy(),
                tp["prob"].to_numpy(),
                image_fig_dir / f"roc_test_patient_{model_name}.png",
                f"图像模型（患者级）：测试集 ROC — {model_name}",
                label=model_name,
            )
            roc_patient_curves.append((model_name, tp["label"].to_numpy(), tp["prob"].to_numpy()))
        except Exception as e:
            print(f"图像 ROC 单模型图跳过 ({model_name}):", e)

        row = {"model": model_name}
        for level_name, level_metrics in result["test_metrics"].items():
            prefix = "test_slice" if level_name == "slice_level" else "test_patient"
            for metric_name, metric_value in level_metrics.items():
                row[f"{prefix}_{metric_name}"] = metric_value
        for level_name, level_metrics in result["val_metrics"].items():
            prefix = "val_slice" if level_name == "slice_level" else "val_patient"
            for metric_name, metric_value in level_metrics.items():
                row[f"{prefix}_{metric_name}"] = metric_value
        leaderboard_rows.append(row)

    leaderboard = pd.DataFrame(leaderboard_rows).sort_values(
        ["test_patient_auc", "test_patient_f1_weighted"],
        ascending=[False, False],
    )
    leaderboard.to_csv(image_report_dir / "image_model_comparison.csv", index=False)
    (image_report_dir / "image_run_meta.json").write_text(json.dumps(run_meta, indent=2, ensure_ascii=False), encoding="utf-8")
    if roc_patient_curves:
        try:
            plot_roc_curves_multi(
                roc_patient_curves,
                image_fig_dir / "roc_test_patient_all_models.png",
                "图像模型：测试集患者级 ROC（多模型）",
            )
        except Exception as e:
            print("图像 ROC 汇总图跳过:", e)
    return leaderboard


@torch.no_grad()
def predict_images(checkpoint_path: Path | str, image_paths: list[str] | list[Path], device: str | None = None) -> pd.DataFrame:
    checkpoint_path = Path(checkpoint_path)
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    model_name = checkpoint["model_name"]
    image_size = int(checkpoint.get("image_size", 224))
    threshold = float(checkpoint.get("threshold", 0.5))
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    model = build_model(model_name).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    _, eval_tf = build_transforms(image_size)
    rows = []
    for image_path in image_paths:
        image_path = Path(image_path)
        image = Image.open(image_path).convert("RGB")
        tensor = eval_tf(image).unsqueeze(0).to(device)
        prob = float(torch.sigmoid(model(tensor).reshape(-1)).cpu().item())
        rows.append(
            {
                "path": str(image_path.resolve()),
                "prob": prob,
                "pred_label": int(prob >= threshold),
                "threshold": threshold,
                "model_name": model_name,
            }
        )
    return pd.DataFrame(rows)
