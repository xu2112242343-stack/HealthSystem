# 模型训练特征整理（当前项目实际使用版）

## 1. 适用范围

- 本文档基于当前项目实际训练配置整理。
- 当前训练特征集：`lite`
- 依据文件：
  - `outputs/reports/run_meta.json`
  - `src/liver_ml/config.py`
  - `src/liver_ml/preprocess.py`
  - `outputs/reports/feature_name_mapping.csv`
  - `data/table/merged_liver_research_列说明.csv`
  - `data/table/liverdisease_description.csv`

## 2. 建模目标说明

- 预测目标：`NAFLD`
- 当前标签定义：`LUXCAPM >= 248.0 dB/m`
- 说明：`LUXCAPM` 是 FibroScan 的 CAP 中位数，用于定义标签，不作为输入特征参与训练。

## 3. 当前实际用于训练的特征总览

- 数值特征：22 个
- 分类特征：4 个
- 总特征数：26 个
- 其中衍生特征：4 个
  - `TyG`
  - `ALT_AST_ratio`
  - `TC_HDL_ratio`
  - `BRI`

## 4. 特征明细

| 字段名 | 可读别称 | 中文含义 | 单位/类别 | 类型 | 是否衍生 | 计算公式/说明 |
|---|---|---|---|---|---|---|
| `RIDAGEYR` | Age | 年龄 | 岁 | 数值 | 否 | 调查时年龄 |
| `BMXWT` | Weight | 体重 | kg | 数值 | 否 | 体格测量值 |
| `BMXHT` | Height | 身高 | cm | 数值 | 否 | 体格测量值 |
| `BMXBMI` | BMI | 体质指数 | kg/m² | 数值 | 否 | 体格测量值 |
| `BMXWAIST` | Waist Circumference | 腰围 | cm | 数值 | 否 | 体格测量值 |
| `BPXSY1` | SBP | 第 1 次收缩压 | mmHg | 数值 | 否 | 首次测量收缩压 |
| `BPXDI1` | DBP | 第 1 次舒张压 | mmHg | 数值 | 否 | 首次测量舒张压 |
| `LBXSATSI` | ALT | 丙氨酸氨基转移酶 | U/L | 数值 | 否 | 肝功能实验室指标 |
| `LBXSASSI` | AST | 天冬氨酸氨基转移酶 | U/L | 数值 | 否 | 肝功能实验室指标 |
| `LBXSGTSI` | GGT | γ-谷氨酰转肽酶 | U/L | 数值 | 否 | 肝胆相关实验室指标 |
| `LBXSTB` | Total Bilirubin | 总胆红素 | mg/dL | 数值 | 否 | 肝胆相关实验室指标 |
| `LBXSAL` | Albumin | 白蛋白 | g/dL | 数值 | 否 | 肝功能/营养状态指标 |
| `LBXGLU` | Fasting Glucose | 空腹血糖 | mg/dL | 数值 | 否 | 空腹子样本实验室指标 |
| `LBXGH` | HbA1c | 糖化血红蛋白 | % | 数值 | 否 | 反映近 2-3 个月平均血糖水平 |
| `LBDHDD` | HDL-C | 高密度脂蛋白胆固醇 | mg/dL | 数值 | 否 | 血脂指标 |
| `LBXTR` | Triglycerides / TG | 甘油三酯 | mg/dL | 数值 | 否 | 血脂指标 |
| `LBDLDL` | LDL-C | 低密度脂蛋白胆固醇 | mg/dL | 数值 | 否 | 血脂指标 |
| `LBXSUA` | Uric Acid | 尿酸 | mg/dL | 数值 | 否 | 代谢相关实验室指标 |
| `TyG` | TyG Index | 甘油三酯-葡萄糖指数 | 无量纲 | 数值 | 是 | `TyG = ln(LBXTR × LBXGLU / 2)` |
| `ALT_AST_ratio` | ALT/AST Ratio | ALT 与 AST 比值 | 比值，无量纲 | 数值 | 是 | `ALT_AST_ratio = LBXSATSI / LBXSASSI` |
| `TC_HDL_ratio` | TC/HDL Ratio | 总胆固醇与 HDL 比值 | 比值，无量纲 | 数值 | 是 | `TC_HDL_ratio = LBXSCH / LBDHDD`。注意：该特征训练时需要原始总胆固醇 `LBXSCH` 参与预处理计算，但最终训练输入保留的是衍生后的比值字段。 |
| `BRI` | Body Roundness Index | 身体圆度指数 | 无量纲 | 数值 | 是 | `BRI = 364.2 - 365.5 × sqrt(1 - ((BMXWAIST / (2π))² / (0.5 × BMXHT)²))`。代码中腰围单位为 cm、身高单位为 cm。 |
| `RIAGENDR` | Sex | 性别 | 分类：`1=男`，`2=女` | 分类 | 否 | 训练前按分类变量处理 |
| `ALQ111` | Alcohol Status | 是否饮酒 | 分类：常用解释为 `1=是`，`2=否` | 分类 | 否 | 饮酒问卷入口题，项目中也用于估算酒精摄入 |
| `SMQ020` | Smoking Status | 吸烟状态/是否至少吸过一定量香烟 | 分类问卷编码 | 分类 | 否 | NHANES 吸烟问卷字段，前端建议保留选项映射 |
| `HCV_AB_POS` | HCV Antibody Positive | 丙肝抗体阳性标记 | 二分类：`1=阳性`，`0=阴性` | 分类 | 是 | 由 `LBDHCI` 派生：当 `LBDHCI ∈ {1,4}` 时记为 1；当 `LBDHCI ∈ {2,3}` 时记为 0；其他记缺失。 |

## 5. 衍生特征来源说明

### 5.1 `TyG`

- 来源字段：
  - `LBXTR`：甘油三酯（mg/dL）
  - `LBXGLU`：空腹血糖（mg/dL）
- 公式：
  - `TyG = ln(TG × FPG / 2)`
- 代码实现：
  - `TyG = np.log(np.maximum(tg * glu / 2.0, 1e-8))`
- 说明：
  - 为避免对数计算报错，代码对极小值做了下限保护。

### 5.2 `ALT_AST_ratio`

- 来源字段：
  - `LBXSATSI`：ALT
  - `LBXSASSI`：AST
- 公式：
  - `ALT_AST_ratio = ALT / AST`
- 说明：
  - 若 `AST = 0`，代码会先替换为缺失，避免除零。

### 5.3 `TC_HDL_ratio`

- 来源字段：
  - `LBXSCH`：总胆固醇（mg/dL）
  - `LBDHDD`：HDL-C（mg/dL）
- 公式：
  - `TC_HDL_ratio = TC / HDL-C`
- 说明：
  - `LBXSCH` 没有作为 lite 特征集的独立原始输入保留，但它在特征工程阶段参与了该衍生特征的计算。
  - 若 `HDL-C = 0`，代码会按缺失处理以避免除零。

### 5.4 `BRI`

- 来源字段：
  - `BMXWAIST`：腰围（cm）
  - `BMXHT`：身高（cm）
- 公式：
  - `BRI = 364.2 - 365.5 × sqrt(1 - ((waist / (2π))² / (0.5 × height)²))`
- 说明：
  - 项目实现直接使用 cm 单位的腰围和身高。
  - 代码中会对根号内结果裁剪到 `[0, 1]` 范围，避免数值误差导致无效值。

### 5.5 `HCV_AB_POS`

- 来源字段：
  - `LBDHCI`：confirmed HCV antibody
- 派生规则：
  - `LBDHCI in {1, 4}` -> `1`
  - `LBDHCI in {2, 3}` -> `0`
  - 其他编码或缺失 -> 缺失
- 说明：
  - 这是一个由原始实验室结果映射得到的二分类特征。

## 6. 面向前端问卷设计的字段建议

### 6.1 建议直接采集的基础字段

- `RIDAGEYR` 年龄
- `RIAGENDR` 性别
- `BMXWT` 体重
- `BMXHT` 身高
- `BMXWAIST` 腰围
- `BPXSY1` 收缩压
- `BPXDI1` 舒张压

### 6.2 建议以“化验单录入”形式采集的实验室字段

- `LBXSATSI` ALT
- `LBXSASSI` AST
- `LBXSGTSI` GGT
- `LBXSTB` 总胆红素
- `LBXSAL` 白蛋白
- `LBXGLU` 空腹血糖
- `LBXGH` HbA1c
- `LBDHDD` HDL-C
- `LBXTR` 甘油三酯
- `LBDLDL` LDL-C
- `LBXSUA` 尿酸

### 6.3 更适合做下拉/单选的分类字段

- `RIAGENDR`
- `ALQ111`
- `SMQ020`
- `HCV_AB_POS`

## 7. 前端实现时需要特别注意

- 当前模型训练使用的是 `lite` 特征集，不是 `full` 特征集。
- 虽然最终训练输入只有 26 个字段，但其中部分衍生特征依赖未直接暴露给模型的原始字段。
- 最典型的是 `TC_HDL_ratio`：
  - 前端如果想复现当前训练特征，除了 `HDL-C` 外，还需要额外收集总胆固醇 `LBXSCH`，否则无法按当前逻辑计算该比值。
- `TyG`、`ALT_AST_ratio`、`TC_HDL_ratio`、`BRI` 都建议由前端或后端自动计算，不建议让用户手填。
- `SMQ020`、`ALQ111` 等问卷字段属于 NHANES 编码变量，前端设计时建议展示为自然语言选项，同时在存储层保留编码映射。

## 8. 建议的问卷字段显示名

| 字段名 | 建议前端展示名 |
|---|---|
| `RIDAGEYR` | 年龄 |
| `RIAGENDR` | 性别 |
| `BMXWT` | 体重 |
| `BMXHT` | 身高 |
| `BMXBMI` | BMI |
| `BMXWAIST` | 腰围 |
| `BPXSY1` | 收缩压 |
| `BPXDI1` | 舒张压 |
| `LBXSATSI` | ALT |
| `LBXSASSI` | AST |
| `LBXSGTSI` | GGT |
| `LBXSTB` | 总胆红素 |
| `LBXSAL` | 白蛋白 |
| `LBXGLU` | 空腹血糖 |
| `LBXGH` | HbA1c |
| `LBDHDD` | HDL-C |
| `LBXTR` | 甘油三酯 |
| `LBDLDL` | LDL-C |
| `LBXSUA` | 尿酸 |
| `TyG` | TyG 指数 |
| `ALT_AST_ratio` | ALT/AST 比值 |
| `TC_HDL_ratio` | 总胆固醇/HDL-C 比值 |
| `BRI` | 身体圆度指数 BRI |
| `ALQ111` | 是否饮酒 |
| `SMQ020` | 吸烟状态 |
| `HCV_AB_POS` | 丙肝抗体阳性 |

## 9. 输出结论

- 当前项目实际训练使用的是一套偏轻量化的混合特征方案。
- 它同时包含：
  - 基础人口学与体格信息
  - 血压
  - 肝功能及代谢实验室指标
  - 少量生活方式/感染状态分类变量
  - 4 个自动计算的衍生特征
- 如果后续要给前端做数据收集问卷，最稳妥的方案是：
  - 直接采原始字段
  - 在系统内自动计算衍生字段
  - 保留分类编码到展示文案的映射层

