from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


"""
将 stroke 结构化 CSV 的 CDC/NHANES 风格列名改成项目 `user_info`（UserHealthInfo）字段名。

说明：
- 该脚本只做“列名替换”，不强制做取值编码转换（例如 1/2 的是非题、性别编码等）。
- 若出现“多个源列映射到同一 user_info 列名”的冲突，会保留第一个映射，后续列保持原名并写入 report。
"""


CDC_TO_USERINFO: dict[str, str] = {
    # ID / 分组（非 user_info 字段，保留）
    # "SEQN": "id",
    # "risk_group": "risk_group",

    # Basic
    "RIDAGEYR": "age",
    "RIAGENDR": "gender",
    "BMXBMI": "bmi",

    # BP / derived
    "LBXSLDSI": "systolic_bp",
    "LBXSASSI": "diastolic_bp",
    "MAP": "map",

    # Disease history / lifestyle (多为 1/2 编码：是/否；脚本不改编码)
    "BPQ020": "has_hypertension",
    "SMQ040": "smoking",
    "PAQ650": "moderate_high_intensity_exercise",
    "PAD680": "sedentary_time_daily",
    "ALQ121": "drinking_frequency",
    "MCQ160C": "has_coronary_heart_disease",
    "MCQ160D": "has_angina",
    "MCQ160E": "has_myocardial_infarction",

    # Labs
    "LBDGLUSI": "fasting_blood_glucose",
    "LBXGH": "hba1c",
    "LBDSTRSI": "triglyceride",
    "LBDSCHSI": "total_cholesterol",
    "LBDHDDSI": "hdl_c",
    "LBDLDLSI": "ldl_c",
    "LBDSCRSI": "serum_creatinine",
    "LBDSBUSI": "urea_nitrogen",
    "LBXSCLSI": "chlorine",
    "LBXLYPCT": "lymphocyte_percent",
    "LBXRDW": "rdw",
    "LBXHGB": "hemoglobin",
    "LBXHCT": "hematocrit",
    "LBXRBCSI": "rbc",

    # 血清铁：此 CSV 同时出现 LBXSIR 与 LBDSIRSI（可能是不同单位/口径）
    # 优先映射 LBDSIRSI → serum_iron，LBXSIR 保留原名以避免覆盖。
    "LBDSIRSI": "serum_iron",
}


def rename_columns(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    report: list[str] = []

    used_targets: set[str] = set()
    new_cols: list[str] = []
    for c in df.columns:
        src = str(c)
        tgt = CDC_TO_USERINFO.get(src, src)
        if tgt != src:
            if tgt in used_targets:
                report.append(f"[冲突] 源列 {src!r} 也映射到 {tgt!r}，已保留原列名避免覆盖。")
                tgt = src
            else:
                used_targets.add(tgt)
        new_cols.append(tgt)

    out = df.copy()
    out.columns = new_cols

    # 记录未映射列（通常是 SEQN / risk_group / 或未纳入 user_info 的特征）
    unmapped = [str(c) for c in df.columns if str(c) not in CDC_TO_USERINFO]
    if unmapped:
        report.append(f"[未映射] 以下列名未在映射表中，已保持原样：{', '.join(unmapped)}")

    # 记录特别处理
    if "LBXSIR" in df.columns:
        report.append(
            "[提示] 检测到 LBXSIR 列未映射（避免与 serum_iron 冲突）。如你确认它也应写入 user_info.serum_iron，"
            "请删除/转换另一列后再映射。"
        )

    return out, report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="input csv path")
    ap.add_argument("--output", required=True, help="output csv path")
    ap.add_argument("--report", required=True, help="report txt path")
    args = ap.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)
    report_path = Path(args.report)

    df = pd.read_csv(in_path, low_memory=False)
    renamed, report = rename_columns(df)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    renamed.to_csv(out_path, index=False, encoding="utf-8-sig")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(report) + ("\n" if report else ""), encoding="utf-8")


if __name__ == "__main__":
    main()

