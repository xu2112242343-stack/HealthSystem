/** 与健康数据页、医生端 QuestionnairePatientRow、FastAPI 预测接口字段对齐 */

export type BasicState = {
  age: string;
  gender: string;
  height: string;
  weight: string;
  waist: string;
  hypertension: string;
  myocardialInfarction: string;
  coronaryHeartDisease: string;
  angina: string;
  gestationalDiabetes: string;
  pcos: string;
  familyHistoryDiabetes: string;
  prediabetes: string;
  antihypertensiveDrugs: string;
  hypoglycemicDrugs: string;
  symptomPolyuria: string;
  symptomWeightLoss: string;
  symptomThirst: string;
  symptomBlurVision: string;
  symptomSlowHealing: string;
};

export type LifestyleState = {
  smoking: string;
  vigorousExercise: string;
  drinkingFrequency: string;
  scaleAlcoholAmount: string;
  scaleWeeklyActivity: string;
  scaleDietQuality: string;
  scaleSleepQuality: string;
  scaleHealthKnowledge: string;
  scaleQualityOfLife: string;
  scaleFatigue: string;
  sedentaryMinutesPerDay: string;
};

export type IndicatorsState = {
  sbp: string;
  dbp: string;
  fpg: string;
  hba1c: string;
  tg: string;
  tc: string;
  hdl: string;
  ldl: string;
  alt: string;
  ast: string;
  ggt: string;
  totalBilirubin: string;
  albumin: string;
  creatinine: string;
  bun: string;
  ldh: string;
  chloride: string;
  serumIron: string;
  hematocrit: string;
  rbc: string;
  rdw: string;
  hemoglobin: string;
  lymphocytePct: string;
  uricAcid: string;
};

export const initialBasic: BasicState = {
  age: '',
  gender: '',
  height: '',
  weight: '',
  waist: '',
  hypertension: '',
  myocardialInfarction: '',
  coronaryHeartDisease: '',
  angina: '',
  gestationalDiabetes: '',
  pcos: '',
  familyHistoryDiabetes: '',
  prediabetes: '',
  antihypertensiveDrugs: '',
  hypoglycemicDrugs: '',
  symptomPolyuria: '',
  symptomWeightLoss: '',
  symptomThirst: '',
  symptomBlurVision: '',
  symptomSlowHealing: '',
};

export const initialLifestyle: LifestyleState = {
  smoking: '',
  vigorousExercise: '',
  drinkingFrequency: '',
  scaleAlcoholAmount: '',
  scaleWeeklyActivity: '',
  scaleDietQuality: '',
  scaleSleepQuality: '',
  scaleHealthKnowledge: '',
  scaleQualityOfLife: '',
  scaleFatigue: '',
  sedentaryMinutesPerDay: '',
};

export const initialIndicators: IndicatorsState = {
  sbp: '',
  dbp: '',
  fpg: '',
  hba1c: '',
  tg: '',
  tc: '',
  hdl: '',
  ldl: '',
  alt: '',
  ast: '',
  ggt: '',
  totalBilirubin: '',
  albumin: '',
  creatinine: '',
  bun: '',
  ldh: '',
  chloride: '',
  serumIron: '',
  hematocrit: '',
  rbc: '',
  rdw: '',
  hemoglobin: '',
  lymphocytePct: '',
  uricAcid: '',
};
