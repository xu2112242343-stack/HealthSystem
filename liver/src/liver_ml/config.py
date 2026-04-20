"""路径与特征列配置。"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_CSV = ROOT / "data" / "table" / "merged_liver_research.csv"
# 用于补充参考脂质、饮酒(ALQ)、HCV 相关实验室列（按 SEQN 左连接）
STROKE_METABOLISM_CSV = ROOT / "data" / "table" / "merged_stroke_metabolism.csv"
LIVERDISEASE_CSV = ROOT / "data" / "table" / "liverdisease.csv"
OUTPUT_DIR = ROOT / "outputs"
MODEL_DIR = OUTPUT_DIR / "models"
FIG_DIR = OUTPUT_DIR / "figures"
REPORT_DIR = OUTPUT_DIR / "reports"

# NAFLD 金标准：CAP 中位数 ≥ 248 dB/m（与论文一致）；标签列名
CAP_COL = "LUXCAPM"
CAP_NAFLD_THRESHOLD = 248.0

# 逻辑回归 / RF / MLP 等：True 时用 IterativeImputer+随机森林近似 missForest（较慢）
USE_ITERATIVE_IMPUTER = False

MCQ_COLS = ["MCQ160L", "MCQ160M", "MCQ160N", "MCQ160O"]

# liverdisease 合并后额外可用的列（存在则纳入）
LIVER_EXTRA_NUMERIC = [
    "LBXIN",
    "LBDINSI",
    "ALQ130",
]

LIVER_EXTRA_CATEGORICAL = [
    "ALQ111",
    "ALQ121",
    "ALQ142",
    "SMQ020",
    "SMQ040",
    "SMQ661",
    "SLQ030",
    "SLQ040",
    "SLQ050",
]

# 全量特征：用于研究分析，保留较多实验室及问卷信息
FULL_NUMERIC_FEATURES = [
    "RIDAGEYR",
    "BMXWT",
    "BMXHT",
    "BMXBMI",
    "BMXWAIST",
    "BMXARMC",
    "BPXSY1",
    "BPXDI1",
    "LBXSBU",
    "LBDSBUSI",
    "LBXSCR",
    "LBDSCRSI",
    "LBXSUA",
    "LBDSUASI",
    "LBXSAPSI",
    "LBXSATSI",
    "LBXSASSI",
    "LBXSGTSI",
    "LBXSLDSI",
    "LBXSTB",
    "LBDSTBSI",
    "LBXSTP",
    "LBDSTPSI",
    "LBXSAL",
    "LBDSALSI",
    "LBXSGB",
    "LBDSGBSI",
    "LBXSCH",
    "LBDSCHSI",
    "LBXSTR",
    "LBDSTRSI",
    "LBXTR",
    "LBDTRSI",
    "LBDLDL",
    "LBDLDLSI",
    "LBXGLU",
    "LBDGLUSI",
    "LBXGH",
    "LBDHDD",
    "LBXWBCSI",
    "LBDLYMNO",
    "LBXLYPCT",
    "LBDNENO",
    "LBXNEPCT",
    "LBXRBCSI",
    "LBXMCVSI",
    "LBXPLTSI",
    "LUXSMED",
    "INDFMPIR",
    "PAD680",
    "TyG",
    "ALT_AST_ratio",
    "ALB_GLOB_ratio",
    "TC_HDL_ratio",
    "BRI",
] + LIVER_EXTRA_NUMERIC

FULL_CATEGORICAL_FEATURES = [
    "RIAGENDR",
    "RIDRETH3",
    "DMDEDUC2",
    "DMDMARTL",
    "LBDHCI",
    "LBXHCG",
] + LIVER_EXTRA_CATEGORICAL

# 轻量特征：优先保留普通用户较容易提供，或常规体检中常见的指标
LITE_NUMERIC_FEATURES = [
    "RIDAGEYR",
    "BMXWT",
    "BMXHT",
    "BMXBMI",
    "BMXWAIST",
    "BPXSY1",
    "BPXDI1",
    "LBXSATSI",
    "LBXSASSI",
    "LBXSGTSI",
    "LBXSTB",
    "LBXSAL",
    "LBXGLU",
    "LBXGH",
    "LBDHDD",
    "LBXTR",
    "LBDLDL",
    "LBXSUA",
    "TyG",
    "ALT_AST_ratio",
    "TC_HDL_ratio",
    "BRI",
]

LITE_CATEGORICAL_FEATURES = [
    "RIAGENDR",
    "ALQ111",
    "SMQ020",
]

FEATURE_SET = os.getenv("LIVER_FEATURE_SET", "lite").strip().lower()
if FEATURE_SET not in {"lite", "full"}:
    FEATURE_SET = "lite"

# 注意：结局由 CAP 定义时，不得将 LUXCAPM 作为预测特征，以免标签泄漏
NUMERIC_FEATURES = LITE_NUMERIC_FEATURES if FEATURE_SET == "lite" else FULL_NUMERIC_FEATURES
CATEGORICAL_FEATURES = LITE_CATEGORICAL_FEATURES if FEATURE_SET == "lite" else FULL_CATEGORICAL_FEATURES

FULL_PA_BINARY = [
    "PAQ605",
    "PAQ620",
    "PAQ635",
    "PAQ650",
    "PAQ665",
]
PA_BINARY = [] if FEATURE_SET == "lite" else FULL_PA_BINARY

# 建模前核心非缺失：结局用 CAP 定义时，训练特征中不含 CAP，此处校验不含 LUXCAPM
CORE_NONMISSING = ["RIDAGEYR", "RIAGENDR", "BMXBMI"]

RANDOM_STATE = 42
