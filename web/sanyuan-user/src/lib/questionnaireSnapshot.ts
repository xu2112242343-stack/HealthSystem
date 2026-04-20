import type { BasicState, IndicatorsState, LifestyleState } from '@/lib/types/questionnaireForm';
import {
  clearLegacyQuestionnaireLocalStorage,
  getQuestionnaireStorageScopeId,
  getScopedQuestionnaireCompletionKey,
  getScopedQuestionnaireSnapshotKey,
  LEGACY_QUESTIONNAIRE_COMPLETION_KEY,
  LEGACY_QUESTIONNAIRE_SNAPSHOT_KEY,
} from '@/lib/questionnaireStorageKeys';

/** 问卷草稿 + 指标（与 DataCollection 同步）；实际键名带用户 scope，见 ``getScopedQuestionnaireSnapshotKey`` */
export const QUESTIONNAIRE_SNAPSHOT_KEY = LEGACY_QUESTIONNAIRE_SNAPSHOT_KEY;

/** 同标签页内保存问卷后派发，便于首页/风险评估重新拉预测 */
export const QUESTIONNAIRE_UPDATED_EVENT = 'sanyuan-questionnaire-updated';

export type QuestionnaireSnapshot = {
  basic: BasicState;
  lifestyle: LifestyleState;
  indicators: IndicatorsState;
  updatedAt: number;
};

function readCompletionImagingFromKey(completionKey: string):
  | { liver: number; diabetes: number; stroke: number }
  | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    const raw = window.localStorage.getItem(completionKey);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as { imagingCounts?: Record<string, number> };
    const ic = p.imagingCounts;
    if (!ic) return undefined;
    return {
      liver: Number(ic.liver ?? 0),
      diabetes: Number(ic.diabetes ?? 0),
      stroke: Number(ic.stroke ?? 0),
    };
  } catch {
    return undefined;
  }
}

export function saveQuestionnaireSnapshot(
  basic: BasicState,
  lifestyle: LifestyleState,
  indicators: IndicatorsState,
): void {
  try {
    if (typeof window === 'undefined') return;
    const payload: QuestionnaireSnapshot = {
      basic,
      lifestyle,
      indicators,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(getScopedQuestionnaireSnapshotKey(), JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(QUESTIONNAIRE_UPDATED_EVENT));
  } catch {
    // ignore quota / private mode
  }
}

export function loadQuestionnaireSnapshot(): QuestionnaireSnapshot | null {
  try {
    if (typeof window === 'undefined') return null;
    const scopedKey = getScopedQuestionnaireSnapshotKey();
    let raw = window.localStorage.getItem(scopedKey);
    if (!raw && getQuestionnaireStorageScopeId() === '__guest__') {
      raw = window.localStorage.getItem(LEGACY_QUESTIONNAIRE_SNAPSHOT_KEY);
    }
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<QuestionnaireSnapshot>;
    if (!p.basic || !p.lifestyle || !p.indicators) return null;
    return {
      basic: p.basic,
      lifestyle: p.lifestyle,
      indicators: p.indicators,
      updatedAt: Number(p.updatedAt ?? 0),
    };
  } catch {
    return null;
  }
}

/** 清除当前 JWT 对应分桶的本地问卷与完成度，并删除旧版全局键（避免串账号）。 */
export function clearQuestionnaireSnapshot(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(getScopedQuestionnaireSnapshotKey());
    window.localStorage.removeItem(getScopedQuestionnaireCompletionKey());
    clearLegacyQuestionnaireLocalStorage();
  } catch {
    /* ignore */
  }
}

function yn(s: string): boolean | undefined {
  if (s === 'yes') return true;
  if (s === 'no') return false;
  return undefined;
}

function num(s: string): number | undefined {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function intScale(s: string, max = 10): number | undefined {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(max, n));
}

/**
 * 转为 FastAPI `POST /api/risk/predict` 可合并进默认画像的字段（仅含已填写项）。
 */
export function buildRiskPredictBody(
  basic: BasicState,
  lifestyle: LifestyleState,
  indicators: IndicatorsState,
  imagingCounts?: { liver: number; diabetes: number; stroke: number },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const age = num(basic.age);
  if (age !== undefined) out.age = Math.round(age);
  if (basic.gender === 'male' || basic.gender === 'female') out.gender = basic.gender;

  const h = num(basic.height);
  if (h !== undefined) out.heightCm = h;
  const w = num(basic.weight);
  if (w !== undefined) out.weightKg = w;
  const waist = num(basic.waist);
  if (waist !== undefined) out.waistCm = waist;

  const putBool = (key: string, s: string) => {
    const b = yn(s);
    if (b !== undefined) out[key] = b;
  };
  putBool('hypertension', basic.hypertension);
  putBool('myocardialInfarction', basic.myocardialInfarction);
  putBool('coronaryHeartDisease', basic.coronaryHeartDisease);
  putBool('angina', basic.angina);
  putBool('familyHistoryDiabetes', basic.familyHistoryDiabetes);
  putBool('prediabetes', basic.prediabetes);
  putBool('antihypertensiveDrugs', basic.antihypertensiveDrugs);
  putBool('hypoglycemicDrugs', basic.hypoglycemicDrugs);
  putBool('smoking', lifestyle.smoking);
  putBool('vigorousExercise', lifestyle.vigorousExercise);

  const df = lifestyle.drinkingFrequency;
  if (df === '0' || df === '1' || df === '2' || df === '3') {
    out.drinkingLevel = parseInt(df, 10);
  }

  const sed = num(lifestyle.sedentaryMinutesPerDay);
  if (sed !== undefined) out.sedentaryMinutesPerDay = Math.round(sed);

  const sc = (
    val: string,
    key:
      | 'scaleAlcoholAmount'
      | 'scaleWeeklyActivity'
      | 'scaleDietQuality'
      | 'scaleSleepQuality'
      | 'scaleHealthKnowledge'
      | 'scaleQualityOfLife'
      | 'scaleFatigue',
  ) => {
    const v = intScale(val);
    if (v !== undefined) out[key] = v;
  };
  sc(lifestyle.scaleAlcoholAmount, 'scaleAlcoholAmount');
  sc(lifestyle.scaleWeeklyActivity, 'scaleWeeklyActivity');
  sc(lifestyle.scaleDietQuality, 'scaleDietQuality');
  sc(lifestyle.scaleSleepQuality, 'scaleSleepQuality');
  sc(lifestyle.scaleHealthKnowledge, 'scaleHealthKnowledge');
  sc(lifestyle.scaleQualityOfLife, 'scaleQualityOfLife');
  sc(lifestyle.scaleFatigue, 'scaleFatigue');

  const metricKeys = [
    'sbp',
    'dbp',
    'fpg',
    'hba1c',
    'tg',
    'tc',
    'hdl',
    'ldl',
    'alt',
    'ast',
    'ggt',
    'uricAcid',
  ] as const;
  for (const k of metricKeys) {
    const v = num(indicators[k]);
    if (v !== undefined) out[k] = v;
  }

  if (imagingCounts) {
    out.imagingLiver = imagingCounts.liver;
    out.imagingDiabetes = imagingCounts.diabetes;
    out.imagingStroke = imagingCounts.stroke;
  }

  return out;
}

/** 供首页 / 风险评估：有快照则带问卷覆盖，否则空对象走后端默认画像 */
export function getRiskPredictRequestBody(): Record<string, unknown> {
  const snap = loadQuestionnaireSnapshot();
  if (!snap) return {};
  const scoped = getScopedQuestionnaireCompletionKey();
  const img =
    readCompletionImagingFromKey(scoped) ??
    (getQuestionnaireStorageScopeId() === '__guest__'
      ? readCompletionImagingFromKey(LEGACY_QUESTIONNAIRE_COMPLETION_KEY)
      : undefined);
  return buildRiskPredictBody(snap.basic, snap.lifestyle, snap.indicators, img);
}
