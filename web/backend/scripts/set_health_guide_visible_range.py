"""将指定 id 区间的文章标记为「在用户端健康生活指南中展示」。

用于误跑 import_qianwen_articles 覆盖了已有文章后的恢复，或批量打开展示开关。

示例::

    cd web/backend
    python -m scripts.set_health_guide_visible_range --min-id 101 --max-id 130
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.persistence import engine, init_db  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="批量设置 health_articles.show_in_health_guide=1（指定 id 区间）")
    parser.add_argument("--min-id", type=int, required=True)
    parser.add_argument("--max-id", type=int, required=True)
    args = parser.parse_args()
    lo, hi = int(args.min_id), int(args.max_id)
    if lo > hi:
        raise SystemExit("min-id 不能大于 max-id")

    init_db()
    with engine.begin() as conn:
        r = conn.execute(
            text(
                "UPDATE health_articles SET show_in_health_guide = 1 "
                "WHERE id >= :lo AND id <= :hi",
            ),
            {"lo": lo, "hi": hi},
        )
        n = r.rowcount if r.rowcount is not None else 0
    print(f"已更新 {n} 条：id ∈ [{lo}, {hi}] 的文章 show_in_health_guide=True")


if __name__ == "__main__":
    main()
