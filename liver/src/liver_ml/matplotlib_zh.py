"""Matplotlib 中文字体：避免标签显示为方框（tofu）。"""
from __future__ import annotations

import os

_CONFIGURED = False


def configure_matplotlib_chinese() -> None:
    """在绘图前调用：优先使用系统已安装的中文字体。"""
    global _CONFIGURED
    if _CONFIGURED:
        return

    import matplotlib.pyplot as plt
    from matplotlib import font_manager

    plt.rcParams["axes.unicode_minus"] = False

    # 按优先级尝试字体族名（Windows 常见；Linux/Mac 可装 Noto）
    family_candidates = [
        "Microsoft YaHei",
        "Microsoft YaHei UI",
        "SimHei",
        "SimSun",
        "NSimSun",
        "KaiTi",
        "FangSong",
        "PingFang SC",
        "Heiti SC",
        "Noto Sans CJK SC",
        "WenQuanYi Micro Hei",
        "Source Han Sans SC",
    ]
    for family in family_candidates:
        try:
            prop = font_manager.FontProperties(family=family)
            try:
                path = font_manager.findfont(prop, fallback_to_default=False)
            except TypeError:
                path = font_manager.findfont(prop)
            if path and "dejavu" not in path.lower():
                plt.rcParams["font.sans-serif"] = [family] + [
                    x for x in plt.rcParams.get("font.sans-serif", []) if x != family
                ]
                plt.rcParams["font.family"] = "sans-serif"
                _CONFIGURED = True
                return
        except Exception:
            continue

    # 直接注册 Windows Fonts 下的 ttc/ttf
    win = os.environ.get("WINDIR", r"C:\Windows")
    for fn in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf", "simsun.ttc", "msjhl.ttc"):
        path = os.path.join(win, "Fonts", fn)
        if os.path.isfile(path):
            try:
                font_manager.fontManager.addfont(path)
                prop = font_manager.FontProperties(fname=path)
                name = prop.get_name()
                plt.rcParams["font.sans-serif"] = [name]
                plt.rcParams["font.family"] = "sans-serif"
                _CONFIGURED = True
                return
            except Exception:
                continue

    plt.rcParams["font.sans-serif"] = [
        "Microsoft YaHei",
        "SimHei",
        "SimSun",
        "DejaVu Sans",
    ]
    plt.rcParams["font.family"] = "sans-serif"
    _CONFIGURED = True
