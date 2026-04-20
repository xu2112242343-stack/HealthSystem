"""生成模拟问卷数据并注册用户，使 user_info 总人数达到目标值。

特点：
- 随机账号（前缀 mocku_），密码统一 123123
- 通过 register_user + apply_questionnaire_to_user 落库，字段与前端问卷一致
- 指标单位与采集页一致：空腹血糖/血脂等为 mmol/L，肌酐 μmol/L，尿素氮 mmol/L，尿酸 μmol/L 等
- 新增用户按权重分配「目标档位」low/mid/high，并用 ``predict_triple`` 校验「三病最高概率」分档：
  pmax<30% 为 low，30%≤pmax<60% 为 mid，pmax≥60% 为 high（与 risk_engine.band 一致）

用法::

    cd web/backend
    python -m scripts.seed_mock_users_to_208 --target 208
    python -m scripts.seed_mock_users_to_208 --target 50 --weights 1:1:1 --max-tries 100
"""

from __future__ import annotations

import argparse
import math
import secrets
import sys
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.models import UserHealthInfo
from app.persistence import SessionLocal, init_db
from app.portal_auth import register_user
from app.questionnaire_save import apply_questionnaire_to_user, user_health_to_predict_dict
from app.risk_engine import predict_triple


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _rnd_int(lo: int, hi: int) -> int:
    return lo + secrets.randbelow(hi - lo + 1)


def _rnd_float(lo: float, hi: float, ndp: int = 2) -> float:
    x = lo + (hi - lo) * (secrets.randbelow(10_000) / 10_000.0)
    return float(round(x, ndp))


def _maybe(pct: float) -> bool:
    return secrets.randbelow(10_000) < int(pct * 100)


def _pmax_band_from_row(row: UserHealthInfo) -> str:
    d = user_health_to_predict_dict(row)
    p = predict_triple(d)["probabilities"]
    pmax = max(float(p["liver"]), float(p["diabetes"]), float(p["stroke"]))
    if pmax < 0.30:
        return "low"
    if pmax < 0.60:
        return "mid"
    return "high"


def _parse_weights(s: str) -> tuple[int, int, int]:
    raw = [x.strip() for x in s.replace(",", ":").split(":") if x.strip()]
    if len(raw) != 3:
        raise SystemExit("--weights 需为三个非负整数，如 1:1:1 表示低:中:高")
    try:
        a, b, c = (max(0, int(raw[0])), max(0, int(raw[1])), max(0, int(raw[2])))
    except ValueError as e:
        raise SystemExit(f"--weights 解析失败: {e}") from e
    if a + b + c == 0:
        raise SystemExit("--weights 之和不能为 0")
    return a, b, c


def _tier_list_for_count(n: int, w: tuple[int, int, int]) -> list[str]:
    """按权重循环生成 n 个目标档位（如 2:1:1 → low,low,mid,high, low,low,...）。"""
    wl, wm, wh = w
    pat = ["low"] * wl + ["mid"] * wm + ["high"] * wh
    return [pat[i % len(pat)] for i in range(n)]


def _mock_questionnaire(target_band: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    """生成问卷四段；target_band 为希望落入的 pmax 档（最终仍可能需重试）。"""
    if target_band not in ("low", "mid", "high"):
        raise ValueError(target_band)

    gender = "男" if _maybe(50) else "女"
    male = gender == "男"

    if target_band == "low":
        age = _rnd_int(22, 58)
        height = _rnd_float(158, 182, 1)
        bmi = _rnd_float(19.5, 24.0, 1)
    elif target_band == "mid":
        age = _rnd_int(35, 68)
        height = _rnd_float(155, 180, 1)
        bmi = _rnd_float(23.5, 29.5, 1)
    else:
        age = _rnd_int(45, 78)
        height = _rnd_float(152, 178, 1)
        bmi = _rnd_float(27.5, 39.0, 1)

    weight = round((height / 100.0) ** 2 * bmi, 1)

    if target_band == "low":
        waist = _rnd_float(64 if not male else 70, 86 if not male else 90, 1)
    elif target_band == "mid":
        waist = _rnd_float(78 if not male else 84, 98 if not male else 102, 1)
    else:
        waist = _rnd_float(92 if not male else 94, 116 if not male else 118, 1)

    if target_band == "low":
        sbp = _rnd_int(102, 128)
        dbp = _rnd_int(62, 82)
        fpg = _rnd_float(4.0, 5.35, 2)
        hba1c = _rnd_float(4.5, 5.45, 2)
        tg = _rnd_float(0.55, 1.35, 2)
        tc = _rnd_float(3.5, 5.05, 2)
        hdl = _rnd_float(1.08, 1.65, 2)
        ldl = _rnd_float(1.85, 3.15, 2)
        alt = _rnd_int(10, 32)
        ast = _rnd_int(12, 30)
        ggt = _rnd_int(12, 42)
    elif target_band == "mid":
        sbp = _rnd_int(126, 148)
        dbp = _rnd_int(76, 94)
        fpg = _rnd_float(5.35, 6.25, 2)
        hba1c = _rnd_float(5.35, 6.15, 2)
        tg = _rnd_float(1.25, 2.35, 2)
        tc = _rnd_float(4.45, 5.95, 2)
        hdl = _rnd_float(0.88, 1.22, 2)
        ldl = _rnd_float(2.55, 3.85, 2)
        alt = _rnd_int(20, 58)
        ast = _rnd_int(20, 48)
        ggt = _rnd_int(28, 110)
    else:
        sbp = _rnd_int(142, 182)
        dbp = _rnd_int(88, 108)
        fpg = _rnd_float(7.5, 12.8, 2)
        hba1c = _rnd_float(6.65, 10.2, 2)
        tg = _rnd_float(2.15, 5.0, 2)
        tc = _rnd_float(5.15, 7.4, 2)
        hdl = _rnd_float(0.72, 1.05, 2)
        ldl = _rnd_float(3.05, 4.95, 2)
        alt = _rnd_int(42, 125)
        ast = _rnd_int(35, 95)
        ggt = _rnd_int(65, 220)

    if dbp >= sbp:
        dbp = max(48, sbp - _rnd_int(12, 38))

    bun = _rnd_float(3.2, 7.8, 2)
    creat = _rnd_float(52.0, 118.0, 1)
    tbil = _rnd_float(6.0, 18.5, 1)
    alb = _rnd_float(38.0, 48.0, 1)
    ua = _rnd_float(210.0, 420.0, 1)

    smoking = _maybe(12 if target_band == "low" else 28 if target_band == "mid" else 48)
    drinking_freq = str(_rnd_int(0, 3))

    ht_by_bp = (sbp >= 140) or (dbp >= 90)
    if target_band == "low":
        hypertension = False
    elif target_band == "mid":
        hypertension = ht_by_bp or _maybe(28)
    else:
        hypertension = ht_by_bp or _maybe(72)

    basic: dict[str, Any] = {
        "age": age,
        "gender": gender,
        "height": height,
        "weight": weight,
        "waist": waist,
        "hypertension": hypertension,
        "familyHistoryDiabetes": _maybe(12 if target_band == "low" else 26 if target_band == "mid" else 40),
        "prediabetes": _maybe(5 if target_band == "low" else 18 if target_band == "mid" else 35),
        "gestationalDiabetes": False if gender == "男" else _maybe(5 if target_band == "low" else 10),
        "pcos": False if gender == "男" else _maybe(4),
        "antihypertensiveDrugs": _maybe(4 if target_band == "low" else 14 if target_band == "mid" else 32),
        "hypoglycemicDrugs": _maybe(2 if target_band == "low" else 12 if target_band == "mid" else 28),
        "symptomPolyuria": _maybe(2 if target_band == "low" else 9 if target_band == "mid" else 22),
        "symptomThirst": _maybe(3 if target_band == "low" else 11 if target_band == "mid" else 26),
        "symptomWeightLoss": _maybe(2 if target_band == "low" else 6 if target_band == "mid" else 15),
        "symptomBlurVision": _maybe(3 if target_band == "low" else 8 if target_band == "mid" else 19),
        "symptomSlowHealing": _maybe(2 if target_band == "low" else 8 if target_band == "mid" else 19),
    }

    lifestyle: dict[str, Any] = {
        "smoking": smoking,
        "vigorousExercise": _maybe(58 if target_band == "low" else 32 if target_band == "mid" else 16),
        "drinkingFrequency": drinking_freq,
        "scaleAlcoholAmount": _rnd_int(0, 9),
        "scaleWeeklyActivity": _rnd_int(2, 14),
        "scaleDietQuality": _rnd_int(3, 10) if target_band == "low" else _rnd_int(1, 8),
        "scaleSleepQuality": _rnd_int(2, 10),
        "scaleHealthKnowledge": _rnd_int(2, 10),
        "scaleQualityOfLife": _rnd_int(3, 10),
        "scaleFatigue": _rnd_int(0, 5) if target_band == "low" else _rnd_int(2, 9),
        "sedentaryMinutesPerDay": _rnd_float(90, 520, 0) if target_band == "low" else _rnd_float(240, 780, 0),
    }

    indicators: dict[str, Any] = {
        "sbp": sbp,
        "dbp": dbp,
        "fpg": fpg,
        "hba1c": hba1c,
        "tg": tg,
        "tc": tc,
        "hdl": hdl,
        "ldl": ldl,
        "alt": alt,
        "ast": ast,
        "ggt": ggt,
        "bun": bun,
        "creatinine": creat,
        "totalBilirubin": tbil,
        "albumin": alb,
        "uricAcid": ua,
    }

    bmi_calc = weight / ((height / 100.0) ** 2) if height > 0 else None
    bmi_calc = _clamp(float(bmi_calc), 15.0, 55.0) if bmi_calc is not None else None
    map_v = dbp + (sbp - dbp) / 3.0
    try:
        tyg = round(math.log(max(tg * fpg / 2.0, 1e-6)), 3)
    except ValueError:
        tyg = _rnd_float(8.1, 10.5, 2)
    tyg = _clamp(tyg, 7.0, 16.0)
    bri = _rnd_float(1.5, 8.5, 2)

    derived: dict[str, Any] = {
        "bmi": round(bmi_calc, 2) if bmi_calc is not None else None,
        "map": round(map_v, 1),
        "tyg": tyg,
        "bri": bri,
    }
    derived = {k: v for k, v in derived.items() if v is not None}
    return basic, lifestyle, indicators, derived


def _unique_account(db: Session) -> str:
    while True:
        acc = f"mocku_{secrets.token_hex(5)}"
        if db.query(UserHealthInfo).filter(UserHealthInfo.user_account == acc).first() is None:
            return acc


def main() -> None:
    parser = argparse.ArgumentParser(description="扩充 user_info 到指定人数（造数 + 与 30%%/60%% 阈值一致校验）")
    parser.add_argument("--target", type=int, default=208, help="目标总人数（含已有）")
    parser.add_argument(
        "--weights",
        type=str,
        default="1:1:1",
        help="新增用户低:中:高「目标档」权重（如 2:1:1 则偏低风险占比更多）",
    )
    parser.add_argument("--max-tries", type=int, default=90, help="单用户最多抽样次数，直到 pmax 档与目标一致")
    args = parser.parse_args()
    target = int(args.target)
    if target <= 0:
        raise SystemExit("target 必须为正整数")
    max_tries = max(1, int(args.max_tries))
    wts = _parse_weights(args.weights)

    init_db()
    db = SessionLocal()
    try:
        cur = db.query(UserHealthInfo).count()
        need = max(0, target - int(cur))
        print(f"当前 user_info={cur}，目标={target}，需新增={need}，权重(low:mid:high)={wts}")
        if need == 0:
            print("已达目标，跳过。")
            return

        tier_plan = _tier_list_for_count(need, wts)
        created = 0
        miss_stats = {"low": 0, "mid": 0, "high": 0}

        for idx in range(need):
            want = tier_plan[idx]
            acc = _unique_account(db)
            row = register_user(db, acc, "123123")
            matched = False
            for attempt in range(max_tries):
                basic, lifestyle, indicators, derived = _mock_questionnaire(want)
                apply_questionnaire_to_user(row, basic=basic, lifestyle=lifestyle, indicators=indicators, derived=derived)
                got = _pmax_band_from_row(row)
                if got == want:
                    matched = True
                    break
            if not matched:
                miss_stats[want] += 1
                print(f"[warn] {acc} 目标={want}，{max_tries} 次后仍为 {_pmax_band_from_row(row)}，保留最后一次写入")

            db.add(row)
            db.commit()
            created += 1

        print(f"完成：新增 {created}，当前总数 {db.query(UserHealthInfo).count()}")
        if any(miss_stats.values()):
            print(f"未完全命中目标的档位数（按目标档统计）: {miss_stats}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
