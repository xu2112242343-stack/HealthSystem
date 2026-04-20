/**
 * 首页/概览页的完成度计算。
 *
 * 旧实现仅依赖 DataCollection 写入的布尔值（basicCompleted 等），容易出现：
 * - 只填 1 个字段却显示 100% 完成（点击“保存”即置 true）
 * - 不同账号/不同浏览器状态下的误差
 *
 * 新实现优先从本地问卷快照（snapshot）按“已填写字段数/总字段数”计算百分比与 completed。
 * 影像上传数量仍从 completion key 读取（保持现有行为）。
 *
 * localStorage 键按当前标签页 JWT（sub / account）分桶，与 sessionStorage 中的 token 一致，
 * 避免多标签登录不同账号时共用同一份进度。
 */

import {
  getQuestionnaireStorageScopeId,
  getScopedQuestionnaireCompletionKey,
  getScopedQuestionnaireSnapshotKey,
  LEGACY_QUESTIONNAIRE_COMPLETION_KEY,
  LEGACY_QUESTIONNAIRE_SNAPSHOT_KEY,
} from '@/lib/questionnaireStorageKeys';

/** @deprecated 仅为兼容导出；实际读写使用 ``getScopedQuestionnaireCompletionKey()`` */
export const QUESTIONNAIRE_COMPLETION_KEY = LEGACY_QUESTIONNAIRE_COMPLETION_KEY;
/** @deprecated 仅为兼容导出 */
export const QUESTIONNAIRE_SNAPSHOT_KEY = LEGACY_QUESTIONNAIRE_SNAPSHOT_KEY;

export type QuestionnaireCompletion = {
  basicCompleted: boolean;
  lifestyleCompleted: boolean;
  indicatorsCompleted: boolean;
  basicProgress: number;
  lifestyleProgress: number;
  indicatorsProgress: number;
  derivedCompleted: boolean;
  derivedProgress: number;
  imagingCounts: { liver: number; diabetes: number; stroke: number };
  updatedAt: number;
};

const defaultQuestionnaireCompletion: QuestionnaireCompletion = {
  basicCompleted: false,
  lifestyleCompleted: false,
  indicatorsCompleted: false,
  basicProgress: 0,
  lifestyleProgress: 0,
  indicatorsProgress: 0,
  derivedCompleted: false,
  derivedProgress: 0,
  imagingCounts: { liver: 0, diabetes: 0, stroke: 0 },
  updatedAt: 0,
};

function safeParseJson(raw: string | null): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pct(filled: number, total: number): number {
  if (!Number.isFinite(filled) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((filled / total) * 100)));
}

function countFilledStrings(obj: unknown): { filled: number; total: number } {
  if (!obj || typeof obj !== 'object') return { filled: 0, total: 0 };
  const values = Object.values(obj as Record<string, unknown>);
  const total = values.length;
  const filled = values.filter((v) => String(v ?? '').trim() !== '').length;
  return { filled, total };
}

function parseNum(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function computeDerivedProgress(snapshot: {
  basic?: Record<string, unknown>;
  indicators?: Record<string, unknown>;
}): { derivedProgress: number; derivedCompleted: boolean } {
  const basic = (snapshot.basic ?? {}) as Record<string, unknown>;
  const indicators = (snapshot.indicators ?? {}) as Record<string, unknown>;

  const hM = parseNum(basic.height);
  const wKg = parseNum(basic.weight);
  const waistCm = parseNum(basic.waist);
  const sbp = parseNum(indicators.sbp);
  const dbp = parseNum(indicators.dbp);
  const fpg = parseNum(indicators.fpg);
  const tg = parseNum(indicators.tg);
  const tc = parseNum(indicators.tc);
  const hdl = parseNum(indicators.hdl);
  const alt = parseNum(indicators.alt);
  const ast = parseNum(indicators.ast);

  const canMap = sbp !== null && dbp !== null;
  const canBmi = hM !== null && wKg !== null && hM > 0;
  const canTyg = tg !== null && tg > 0 && fpg !== null && fpg > 0;
  const canAltAst = alt !== null && ast !== null && ast !== 0;
  const canTcHdl = tc !== null && hdl !== null && hdl !== 0;
  const canBri = waistCm !== null && hM !== null && waistCm > 0 && hM > 0;

  const done = [canMap, canBmi, canTyg, canAltAst, canTcHdl, canBri].filter(Boolean).length;
  const derivedProgress = pct(done, 6);
  return { derivedProgress, derivedCompleted: derivedProgress >= 100 };
}

function readLocalStorageWithGuestFallback(scopedKey: string, legacyKey: string): string | null {
  if (typeof window === 'undefined') return null;
  const scoped = window.localStorage.getItem(scopedKey);
  if (scoped) return scoped;
  if (getQuestionnaireStorageScopeId() === '__guest__') {
    return window.localStorage.getItem(legacyKey);
  }
  return null;
}

export function readQuestionnaireCompletion(): QuestionnaireCompletion {
  try {
    if (typeof window === 'undefined') return defaultQuestionnaireCompletion;

    const completionKey = getScopedQuestionnaireCompletionKey();
    const snapshotKey = getScopedQuestionnaireSnapshotKey();

    const parsedCompletion = safeParseJson(
      readLocalStorageWithGuestFallback(completionKey, LEGACY_QUESTIONNAIRE_COMPLETION_KEY),
    ) as Partial<QuestionnaireCompletion> | null;

    const snap = safeParseJson(
      readLocalStorageWithGuestFallback(snapshotKey, LEGACY_QUESTIONNAIRE_SNAPSHOT_KEY),
    ) as { basic?: unknown; lifestyle?: unknown; indicators?: unknown; updatedAt?: unknown } | null;

    const basicCount = countFilledStrings(snap?.basic);
    const lifestyleCount = countFilledStrings(snap?.lifestyle);
    const indicatorsCount = countFilledStrings(snap?.indicators);

    const basicProgress = pct(basicCount.filled, basicCount.total);
    const lifestyleProgress = pct(lifestyleCount.filled, lifestyleCount.total);
    const indicatorsProgress = pct(indicatorsCount.filled, indicatorsCount.total);

    const computed = {
      basicProgress,
      lifestyleProgress,
      indicatorsProgress,
      basicCompleted: basicProgress >= 100,
      lifestyleCompleted: lifestyleProgress >= 100,
      indicatorsCompleted: indicatorsProgress >= 100,
      ...computeDerivedProgress({
        basic: (snap?.basic as Record<string, unknown>) ?? {},
        indicators: (snap?.indicators as Record<string, unknown>) ?? {},
      }),
      updatedAt: Number(snap?.updatedAt ?? parsedCompletion?.updatedAt ?? 0),
    };

    return {
      ...defaultQuestionnaireCompletion,
      ...(parsedCompletion ?? {}),
      ...computed,
      imagingCounts: {
        liver: Number(parsedCompletion?.imagingCounts?.liver ?? 0),
        diabetes: Number(parsedCompletion?.imagingCounts?.diabetes ?? 0),
        stroke: Number(parsedCompletion?.imagingCounts?.stroke ?? 0),
      },
    };
  } catch {
    return defaultQuestionnaireCompletion;
  }
}
