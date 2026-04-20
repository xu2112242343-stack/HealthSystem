"""原始变量名 → 可读中文名；用于报告与 SHAP 输出。"""
from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    import pandas as pd

# 列名 → 简短中文（实验室/体格/问卷）
FEATURE_DISPLAY_NAMES: dict[str, str] = {
    "RIDAGEYR": "年龄(岁)",
    "RIAGENDR": "性别",
    "RIDRETH3": "种族/族裔",
    "DMDEDUC2": "教育程度",
    "DMDMARTL": "婚姻状况",
    "BMXWT": "体重(kg)",
    "BMXHT": "身高(cm)",
    "BMXBMI": "BMI",
    "BMXWAIST": "腰围(cm)",
    "BMXARMC": "上臂围(cm)",
    "BPXSY1": "收缩压(mmHg)",
    "BPXDI1": "舒张压(mmHg)",
    "LBXSBU": "血尿素氮(BUN)",
    "LBDSBUSI": "血尿素氮(mmol/L)",
    "LBXSCR": "血清肌酐(mg/dL)",
    "LBDSCRSI": "血清肌酐(μmol/L)",
    "LBXSUA": "血清尿酸",
    "LBDSUASI": "血清尿酸(SI)",
    "LBXSAPSI": "碱性磷酸酶(ALP)",
    "LBXSATSI": "ALT",
    "LBXSASSI": "AST",
    "LBXSGTSI": "GGT",
    "LBXSLDSI": "乳酸脱氢酶(LDH)",
    "LBXSTB": "总胆红素",
    "LBDSTBSI": "总胆红素(SI)",
    "LBXSTP": "总蛋白",
    "LBDSTPSI": "总蛋白(SI)",
    "LBXSAL": "白蛋白",
    "LBDSALSI": "白蛋白(SI)",
    "LBXSGB": "球蛋白",
    "LBDSGBSI": "球蛋白(SI)",
    "LBXSCH": "总胆固醇",
    "LBDSCHSI": "总胆固醇(SI)",
    "LBXSTR": "甘油三酯",
    "LBDSTRSI": "甘油三酯(SI)",
    "LBXGLU": "空腹血糖",
    "LBDGLUSI": "空腹血糖(SI)",
    "LBXGH": "HbA1c",
    "LBDHDD": "HDL‑C",
    "LBXWBCSI": "白细胞计数",
    "LBDLYMNO": "淋巴细胞绝对值",
    "LBXLYPCT": "淋巴细胞%",
    "LBDNENO": "中性粒细胞绝对值",
    "LBXNEPCT": "中性粒细胞%",
    "LBXRBCSI": "红细胞计数",
    "LBXMCVSI": "平均红细胞体积(MCV)",
    "LBXPLTSI": "血小板",
    "LUXCAPM": "CAP(肝脂肪)",
    "LUXSMED": "肝脏硬度(kPa)",
    "INDFMPIR": "贫困收入比(PIR)",
    "PAD680": "久坐时间(分/日)",
    "TyG": "TyG指数",
    "ALT_AST_ratio": "ALT/AST比值",
    "ALB_GLOB_ratio": "白蛋白/球蛋白",
    "TC_HDL_ratio": "总胆固醇/HDL‑C",
    "BRI": "身体围度指数(BRI)",
    "PAQ605": "工作剧烈活动(是否)",
    "PAQ620": "工作中等活动(是否)",
    "PAQ635": "步行/骑车通勤(是否)",
    "PAQ650": "剧烈娱乐运动(是否)",
    "PAQ665": "中等娱乐运动(是否)",
    # liverdisease 补充
    "LBXIN": "空腹胰岛素",
    "LBDINSI": "空腹胰岛素(SI)",
    "ALQ130": "饮酒量(次/量编码)",
    "ALQ121": "饮酒频率",
    "ALQ142": "每次饮酒量",
    "ALQ111": "是否饮酒",
    "SMQ020": "吸烟状态",
    "SMQ040": "现在吸烟",
    "SMQ661": "戒烟相关",
    "SLQ030": "睡眠障碍(编码)",
    "SLQ040": "睡眠时长相关",
    "SLQ050": "睡眠相关",
}


def write_column_mapping_csv(num_cols: list[str], cat_cols: list[str], path) -> None:
    """导出原始列名 → 中文展示名（建模列）。"""
    import pandas as pd

    rows = []
    for c in num_cols:
        rows.append({"column": c, "display_zh": FEATURE_DISPLAY_NAMES.get(c, c), "role": "numeric"})
    for c in cat_cols:
        rows.append({"column": c, "display_zh": FEATURE_DISPLAY_NAMES.get(c, c), "role": "categorical"})
    pd.DataFrame(rows).to_csv(path, index=False, encoding="utf-8-sig")


def _strip_prefix(name: str) -> tuple[str, str | None]:
    """返回 (类型前缀, 去前缀名)。"""
    if name.startswith("num__"):
        return "num", name[5:]
    if name.startswith("cat__"):
        return "cat", name[5:]
    return "", name


def prettify_feature_name(sklearn_name: str) -> str:
    """
    将 ColumnTransformer 输出名转为可读中文。
    例如 num__RIDAGEYR → 年龄(岁)；cat__RIAGENDR_1.0 → 性别=1.0
    """
    kind, rest = _strip_prefix(sklearn_name)
    if not kind:
        return FEATURE_DISPLAY_NAMES.get(rest, rest)

    if kind == "num":
        return FEATURE_DISPLAY_NAMES.get(rest, rest)

    # cat__COL_value（最后一处下划线分隔取值）
    if "_" in rest:
        col, val = rest.rsplit("_", 1)
        label = FEATURE_DISPLAY_NAMES.get(col, col)
        return f"{label}={val}"
    return FEATURE_DISPLAY_NAMES.get(rest, rest)


def prettify_feature_names(names: list[str] | np.ndarray) -> list[str]:
    import numpy as np

    if isinstance(names, np.ndarray):
        names = names.tolist()
    return [prettify_feature_name(str(n)) for n in names]


def rename_series_index_display(s: "pd.Series") -> "pd.Series":
    """Series 索引为 sklearn 特征名时替换为可读名。"""
    out = s.copy()
    out.index = [prettify_feature_name(str(i)) for i in s.index]
    return out
