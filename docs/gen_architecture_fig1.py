#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成作品报告 1.3 节「图1 作品整体架构图」PNG。"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT_PATH = Path(__file__).resolve().parent / "图1_作品整体架构图.png"

# 中文字体（Windows 常见）
plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Arial Unicode MS", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


def rounded_box(ax, xy, w, h, fc, ec, lw=1.5, ls="-", radius=0.02, zorder=2):
    box = FancyBboxPatch(
        xy,
        w,
        h,
        boxstyle=f"round,pad=0.012,rounding_size={radius}",
        facecolor=fc,
        edgecolor=ec,
        linewidth=lw,
        linestyle=ls,
        zorder=zorder,
    )
    ax.add_patch(box)
    return box


def label(ax, x, y, text, size=9, color="#1a1a1a", weight="normal", ha="center", va="center", zorder=5):
    ax.text(x, y, text, fontsize=size, color=color, weight=weight, ha=ha, va=va, zorder=zorder)


def bi_arrow(ax, x1, y1, x2, y2, color="#2b6cb0", lw=2.2, zorder=1):
    arr = FancyArrowPatch(
        (x1, y1),
        (x2, y2),
        arrowstyle="<->",
        mutation_scale=14,
        linewidth=lw,
        color=color,
        zorder=zorder,
        shrinkA=2,
        shrinkB=2,
    )
    ax.add_patch(arr)


def draw() -> None:
    fig, ax = plt.subplots(figsize=(14, 10), dpi=200)
    ax.set_xlim(0, 14)
    ax.set_ylim(0, 10)
    ax.axis("off")
    fig.patch.set_facecolor("white")

    # ── 顶部：延伸服务 ──
    rounded_box(ax, (1.2, 8.55), 11.6, 1.05, "#fffef5", "#d4a017", lw=1.8, ls="--", radius=0.04)
    services = ["健康数据采集", "风险评估", "干预方案", "健康指南", "就医推荐", "周期复评"]
    sx0, sw, sh = 1.55, 1.72, 0.55
    for i, s in enumerate(services):
        x = sx0 + i * (sw + 0.18)
        rounded_box(ax, (x, 8.78), sw, sh, "#1e4d8c", "#1e4d8c", lw=0.8, radius=0.02)
        label(ax, x + sw / 2, 9.05, s, size=8.5, color="white", weight="bold")

    # ── 外部系统（橙色）──
    ext_left = [("临床指南\n知识库", 1.35), ("公开数据集\n(NHANES等)", 3.55)]
    ext_right = [("MySQL\n业务数据库", 10.05), ("多模态\n推理服务", 12.25)]
    for text, x in ext_left + ext_right:
        rounded_box(ax, (x, 7.35), 1.85, 0.72, "#f6ad55", "#dd6b20", lw=1.2, radius=0.025)
        label(ax, x + 0.925, 7.71, text, size=8, weight="bold")

    label(ax, 2.6, 7.05, "数据交换", size=8.5, color="#2b6cb0", weight="bold")
    label(ax, 11.15, 7.05, "数据交换", size=8.5, color="#2b6cb0", weight="bold")
    bi_arrow(ax, 2.25, 7.28, 4.85, 6.55, lw=2)
    bi_arrow(ax, 3.75, 7.28, 5.35, 6.55, lw=2)
    bi_arrow(ax, 10.95, 7.28, 8.55, 6.55, lw=2)
    bi_arrow(ax, 12.45, 7.28, 9.05, 6.55, lw=2)
    bi_arrow(ax, 7.0, 8.55, 7.0, 6.95, color="#2b6cb0", lw=2.5)
    label(ax, 7.55, 7.75, "延伸\n服务", size=8.5, color="#2b6cb0", weight="bold")

    # ── 核心平台 ──
    rounded_box(ax, (3.6, 3.55), 6.8, 3.35, "#e8f4fc", "#5b9bd5", lw=2.2, ls="--", radius=0.05)
    rounded_box(ax, (3.95, 5.55), 2.85, 1.05, "#ffffff", "#5b9bd5", lw=1.5, radius=0.03)
    rounded_box(ax, (7.2, 5.55), 2.85, 1.05, "#ffffff", "#5b9bd5", lw=1.5, radius=0.03)
    label(ax, 5.375, 6.05, "多模态AI\n风险引擎", size=10, weight="bold", color="#1e4d8c")
    label(ax, 8.625, 6.05, "三病协同\n传播算法", size=10, weight="bold", color="#1e4d8c")
    bi_arrow(ax, 6.8, 6.05, 7.2, 6.05, lw=1.8)

    # 三端应用
    apps = [("用户端", 4.15), ("医生端", 5.55), ("管理员端", 6.95), ("统一门户", 8.35)]
    for name, x in apps:
        rounded_box(ax, (x, 4.72), 1.15, 0.52, "#2b6cb0", "#1e4d8c", lw=0.8, radius=0.02)
        label(ax, x + 0.575, 4.98, name, size=8, color="white", weight="bold")

    label(
        ax,
        7.0,
        4.15,
        "肝病-糖尿病-脑卒中\n协同早筛与健康管理平台",
        size=11.5,
        weight="bold",
        color="#1e4d8c",
    )

    # ── 左侧：运营机构 ──
    rounded_box(ax, (0.35, 3.85), 2.35, 2.55, "#fafafa", "#718096", lw=1.5, ls="--", radius=0.04)
    inst = ["社区\n卫生服务中心", "三甲\n医院", "基层\n筛查站点"]
    for i, t in enumerate(inst):
        y = 5.65 - i * 0.78
        rounded_box(ax, (0.55, y - 0.28), 1.95, 0.56, "#1e4d8c", "#1e4d8c", lw=0.8, radius=0.02)
        label(ax, 1.525, y, t, size=8.5, color="white", weight="bold")
    bi_arrow(ax, 2.7, 5.1, 3.6, 5.1, lw=2.8)
    label(ax, 3.15, 5.45, "运营", size=10, color="#2b6cb0", weight="bold")

    # ── 右侧：用户与多模态数据 ──
    rounded_box(ax, (10.55, 5.55), 1.35, 0.62, "#38a169", "#276749", lw=1.2, radius=0.025)
    label(ax, 11.225, 5.86, "居民/患者", size=9.5, color="white", weight="bold")

    rounded_box(ax, (10.15, 3.95), 2.15, 1.35, "#edf2f7", "#718096", lw=1.5, ls="--", radius=0.035)
    inputs = ["结构化\n问卷", "肝脏\n超声", "眼底\n影像", "卒中\n影像(DCM)"]
    for i, t in enumerate(inputs):
        x = 10.35 + (i % 2) * 1.05
        y = 4.95 - (i // 2) * 0.62
        rounded_box(ax, (x, y - 0.22), 0.92, 0.44, "#4299e1", "#2b6cb0", lw=0.8, radius=0.02)
        label(ax, x + 0.46, y, t, size=7.2, color="white", weight="bold")

    bi_arrow(ax, 11.225, 5.55, 11.225, 5.35, lw=1.5)
    bi_arrow(ax, 10.15, 5.1, 10.4, 5.1, lw=2.8)
    label(ax, 9.55, 5.45, "采集\n监测", size=9, color="#2b6cb0", weight="bold")

    # 场景
    for text, y in [("居家", 6.55), ("基层", 5.55), ("体检", 4.55), ("教学", 3.55)]:
        rounded_box(ax, (12.55, y - 0.32), 0.95, 0.64, "#1e4d8c", "#1e4d8c", lw=0.8, radius=0.02)
        label(ax, 13.025, y, text, size=9, color="white", weight="bold")

    # ── 底部：家属 ──
    rounded_box(ax, (6.05, 0.55), 1.9, 0.62, "#38a169", "#276749", lw=1.2, radius=0.025)
    label(ax, 7.0, 0.86, "家属", size=10, color="white", weight="bold")
    bi_arrow(ax, 7.0, 1.17, 7.0, 3.55, lw=2.8)
    label(ax, 7.55, 2.35, "交流\n协同", size=9, color="#2b6cb0", weight="bold")

    # 图题
    label(ax, 7.0, 0.15, "图 1  作品整体架构图", size=11, weight="bold", color="#333333")

    fig.tight_layout(pad=0.2)
    fig.savefig(OUT_PATH, bbox_inches="tight", facecolor="white", dpi=200)
    plt.close(fig)
    print(f"Saved: {OUT_PATH}")


if __name__ == "__main__":
    draw()
