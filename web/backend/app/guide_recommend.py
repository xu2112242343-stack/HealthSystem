"""健康生活指南推荐：三病全低则按类型全量推送；存在中/高风险则按病种 + 文章风险标签匹配。"""

from __future__ import annotations

from typing import Any

from app.models import HealthArticle, UserHealthInfo

# 三病轴 → 采集规范疾病名（与 health_articles.disease 字段一致）
GUIDE_DISEASE_BY_AXIS: dict[str, str] = {
    "liver": "代谢相关脂肪性肝病",
    "diabetes": "2型糖尿病",
    "stroke": "脑卒中",
}

# 三病均为低风险时：只推这些类型，且不筛选文章 risk_level
LOW_RISK_TYPES_EXACT: tuple[str, ...] = ("饮食/运动类", "认知类（疾病介绍）")

# 用户某轴为中/高时，按标题是否含该病种用语排序（肝 / 糖尿病 / 卒中三轴规则相同）：
# tuple 中越靠前越优先匹配（更具体的关键词得分更高）；多轴同时升高则标题可同时为多个轴加分。
_TITLE_KEYWORDS_BY_AXIS: dict[str, tuple[str, ...]] = {
    "liver": (
        "代谢相关脂肪性肝病",
        "MAFLD",
        "非酒精性脂肪性肝病",
        "脂肪性肝病",
        "脂肪肝",
        "肝病",
        "肝脏",
    ),
    "diabetes": (
        "2型糖尿病",
        "二型糖尿病",
        "糖化血红蛋白",
        "HbA1c",
        "糖尿病",
        "糖尿病前期",
        "高血糖",
        "血糖",
        "胰岛素抵抗",
        "胰岛素",
        "胰岛",
    ),
    "stroke": (
        "缺血性脑卒中",
        "出血性脑卒中",
        "脑卒中",
        "脑血管病",
        "脑血管",
        "脑梗死",
        "脑梗",
        "脑出血",
        "卒中",
        "中风",
    ),
}


def _title_priority_elevated(title: str | None, risks: dict[str, Any]) -> int:
    """仅统计当前为中/高风险的轴；标题命中该轴任一关键词则加分（每轴取命中词中最高一档）。"""
    t = title or ""
    total = 0
    for ax, keywords in _TITLE_KEYWORDS_BY_AXIS.items():
        if risks[ax]["level"] not in ("medium", "high"):
            continue
        axis_best = 0
        for i, kw in enumerate(keywords):
            if kw in t:
                axis_best = max(axis_best, 1000 - i)
        total += axis_best
    return total


def _type_is_cognitive_or_diet(t: str | None) -> bool:
    if not t or not str(t).strip():
        return False
    s = str(t).strip()
    if s in LOW_RISK_TYPES_EXACT:
        return True
    if s == "认知类":
        return True
    if "饮食" in s and "运动" in s:
        return True
    if "认知" in s and ("疾病" in s or "介绍" in s):
        return True
    return False


def _article_matches_axis_risk(a: HealthArticle, disease_label: str, user_level: str) -> bool:
    dis = a.disease or ""
    if disease_label not in dis:
        return False
    rl = a.risk_level or ""
    if user_level == "medium":
        return "中风险" in rl
    if user_level == "high":
        return "高风险" in rl
    return False


def _article_matches_axis_relaxed(ax: str, a: HealthArticle, disease_label: str) -> bool:
    """病种或标题/摘要用语命中该轴即可（不校验文章 risk_level），用于严格匹配为空时的回退。"""
    dis = a.disease or ""
    tit = (a.title or "") + "\n" + (a.summary or "")
    if disease_label in dis:
        return True
    for kw in _TITLE_KEYWORDS_BY_AXIS.get(ax, ()):
        if kw and (kw in dis or kw in tit):
            return True
    return False


def _article_matches_axis_risk_fuzzy(a: HealthArticle, disease_label: str, user_level: str) -> bool:
    """用户中/高时：文章病种命中且 risk_level 与「用户档位」兼容（高可匹配含中/高标签的文章）。"""
    dis = a.disease or ""
    if disease_label not in dis:
        return False
    rl = a.risk_level or ""
    if user_level == "high":
        return "高风险" in rl or "中风险" in rl
    if user_level == "medium":
        return "中风险" in rl or "高风险" in rl
    return False


def select_health_guides_for_user(
    _user: UserHealthInfo,
    predict_raw: dict[str, Any],
    articles: list[HealthArticle],
) -> list[HealthArticle]:
    """
    - 三病均为低风险：返回所有「认知类 / 饮食·运动类」文章（忽略文章 risk_level），按 id 降序。
    - 任一侧为中/高：优先 disease + 文章 risk_level 严格匹配；若无结果则尝试「病种+与用户档位兼容」的
      risk_level；仍无则按病种/标题关键词放宽匹配；再不行则回退为与全低相同的认知+饮食/运动类，
      保证有文时可展示。
    """
    risks = predict_raw["risk"]
    all_low = all(risks[ax]["level"] == "low" for ax in ("liver", "diabetes", "stroke"))

    if all_low:
        out = [a for a in articles if _type_is_cognitive_or_diet(a.type)]
    else:
        seen: set[int] = set()
        out: list[HealthArticle] = []

        def _collect(matcher) -> None:
            for ax, disease_label in GUIDE_DISEASE_BY_AXIS.items():
                level = risks[ax]["level"]
                if level not in ("medium", "high"):
                    continue
                for a in articles:
                    if a.id in seen:
                        continue
                    if matcher(ax, disease_label, level, a):
                        seen.add(a.id)
                        out.append(a)

        def _strict(ax: str, disease_label: str, level: str, a: HealthArticle) -> bool:
            return _article_matches_axis_risk(a, disease_label, level)

        def _fuzzy(ax: str, disease_label: str, level: str, a: HealthArticle) -> bool:
            return _article_matches_axis_risk_fuzzy(a, disease_label, level)

        def _relaxed(ax: str, disease_label: str, level: str, a: HealthArticle) -> bool:
            return _article_matches_axis_relaxed(ax, a, disease_label)

        _collect(_strict)
        if not out:
            _collect(_fuzzy)
        if not out:
            seen.clear()
            _collect(_relaxed)
        if not out:
            out = [a for a in articles if _type_is_cognitive_or_diet(a.type)]

    if all_low:
        out.sort(key=lambda x: -x.id)
    else:
        out.sort(
            key=lambda x: (
                -_title_priority_elevated(x.title, risks),
                -x.id,
            ),
        )
    return out
