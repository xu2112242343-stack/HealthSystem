# NHANES liver data review

## 1) Current cycle

- `merged_liver_research.csv` and `merged_stroke_metabolism.csv` both contain `SDDSRVYR = 10` only.
- In the NHANES 2017-2018 demographics codebook, `SDDSRVYR = 10` is explicitly defined as the `2017-2018` release cycle.
- Current row count in these merged analysis tables is `3036`; after the existing adult/CAP/viral hepatitis/alcohol exclusions, the training sample is `2171`.

Official source:
- DEMO_J: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/DEMO_J.htm

## 2) Main NHANES source files behind the current columns

- `DEMO_J`: demographics, weights, PSU/strata, age, sex, race, PIR
- `BIOPRO_J`: ALT/AST/GGT/bilirubin/albumin/total protein/globulin/cholesterol/triglycerides/uric acid and SI-unit companion columns
- `GLU_J`: fasting glucose (`LBXGLU`, `LBDGLUSI`, `WTSAF2YR`)
- `GHB_J`: glycohemoglobin / HbA1c (`LBXGH`)
- `LUX_J`: FibroScan stiffness and CAP (`LUXSMED`, `LUXCAPM`)
- `HEPC_J`: HCV RNA (`LBXHCR`), confirmed HCV antibody (`LBDHCI`), genotype (`LBXHCG`)

Official sources:
- BIOPRO_J: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/BIOPRO_J.htm
- GLU_J: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/GLU_J.htm
- GHB_J: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/GHB_J.htm
- LUX_J: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/LUX_J.htm
- HEPC_J: https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/HEPC_J.htm

## 3) Key variable notes relevant to the current model

- `LBDSGTLC` in `BIOPRO_J` is the `GGT Comment Code`, not the main GGT value itself. The usable analyte is `LBXSGTSI`.
- `LBXGLU` in `GLU_J` is fasting glucose from the morning fasting subsample; `WTSAF2YR` is the matching fasting subsample weight.
- `LBXGH` in `GHB_J` is glycohemoglobin / HbA1c.
- `LUXCAPM` in `LUX_J` is median CAP in `dB/m`, which is what the current label uses.
- `LBDHCI` in `HEPC_J` is confirmed HCV antibody:
  - `1 = Positive`
  - `2 = Negative`
  - `3 = Negative screening HCV antibody`
  - `4 = Positive HCV RNA`
- `LBXHCR` in `HEPC_J` is HCV RNA:
  - `1 = Positive`
  - `2 = Negative`
  - `3 = Negative screening HCV antibody`

## 4) Redundancy findings

Several lab columns are effectively unit-converted duplicates and should not be modeled together in a simplified user-facing model.

Examples from the current data:

- `LBXSAL` vs `LBDSALSI`: correlation `1.000000`
- `LBXSCR` vs `LBDSCRSI`: correlation `1.000000`
- `LBXSGB` vs `LBDSGBSI`: correlation `1.000000`
- `LBXSCH` vs `LBDSCHSI`: correlation `1.000000`
- `LBXSTR` vs `LBDSTRSI`: correlation `1.000000`
- `LBXGLU` vs `LBDGLUSI`: correlation `0.999995`

Recommendation:

- Keep one unit system only in the app-facing model.
- Prefer clinically familiar units for users:
  - glucose `mg/dL`
  - triglycerides `mg/dL`
  - bilirubin `mg/dL`
  - albumin `g/dL`
  - uric acid `mg/dL`

## 5) Missingness signals

The highest-missing blocks are the detailed smoking follow-up items, detailed diabetes history branches, and detailed physical-activity duration questions.

These are poor candidates for a public upload workflow because they are:

- hard for users to answer accurately
- highly branched
- structurally missing for many people

Examples with very high missingness in the raw merged tables:

- smoking follow-up items such as `SMQ665*`, `SMQ661`, `SMD630`
- detailed diabetes treatment/history items such as `DID060`, `DIQ060U`, `DID250`, `DIQ260U`
- detailed activity duration items such as `PAD615`, `PAD630`, `PAD645`, `PAD660`, `PAD675`

## 6) Suggested lightweight app feature set

This is now the default `lite` feature set in the training config:

- demographics: `RIDAGEYR`, `RIAGENDR`
- body size: `BMXWT`, `BMXHT`, `BMXBMI`, `BMXWAIST`
- blood pressure: `BPXSY1`, `BPXDI1`
- liver-related labs: `LBXSATSI`, `LBXSASSI`, `LBXSGTSI`, `LBXSTB`, `LBXSAL`
- metabolic labs: `LBXGLU`, `LBXGH`, `LBDHDD`, `LBXTR`, `LBDLDL`, `LBXSUA`
- engineered features: `TyG`, `ALT_AST_ratio`, `TC_HDL_ratio`, `BRI`
- simple lifestyle / infection flags: `ALQ111`, `SMQ020`, `HCV_AB_POS`

## 7) HCV additions now wired into preprocessing

The preprocessing pipeline now supplements the base table from `merged_stroke_metabolism.csv` with:

- `LBDHCI`
- `LBXHCR`
- `LBXHCG`
- `LBXTR`
- `LBDTRSI`
- `LBDLDL`
- `LBDLDLSI`

It also derives:

- `HCV_AB_POS`
  - positive for `LBDHCI in {1, 4}`
  - negative for `LBDHCI in {2, 3}`

Current non-missing counts after preprocessing:

- `LBDHCI`: `2050`
- `LBXHCR`: `2053`
- `LBXTR`: `2056`
- `LBDLDL`: `2034`
- `HCV_AB_POS`: `2050`

## 8) LASSO initial feature selection

Added outputs:

- `outputs/reports/lasso_selected_transformed_features.csv`
- `outputs/reports/lasso_selected_raw_features.csv`
- `outputs/models/lasso_cv_model.joblib`

On the current `lite` feature set, the strongest raw features selected by L1 logistic regression were:

1. `TyG`
2. `BMXWAIST`
3. `BMXBMI`
4. `ALT_AST_ratio`
5. `RIDAGEYR`
6. `BRI`
7. `LBXGLU`
8. `LBXSTB`
9. `BPXDI1`
10. `BPXSY1`

Observed LASSO-CV performance on the current split:

- validation AUC: `0.85896`
- test AUC: `0.85411`

## 9) Practical next step

For a public-facing prediction form, prioritize:

- age, sex
- height, weight, waist
- blood pressure
- ALT, AST, GGT, bilirubin
- fasting glucose or HbA1c
- triglycerides and HDL

Treat these as optional, not mandatory:

- alcohol status
- smoking status
- HCV antibody

This keeps the form much shorter while still covering the variables most consistently retained by the first-pass LASSO screen.
