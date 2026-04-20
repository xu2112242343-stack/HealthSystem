import { getJson, postJson } from '@/lib/api';
import type { BasicState, IndicatorsState, LifestyleState } from '@/lib/types/questionnaireForm';
import { initialBasic, initialIndicators, initialLifestyle } from '@/lib/types/questionnaireForm';

export type QuestionnaireDerivedPayload = Record<string, string>;

export type UserQuestionnaireResponse = {
  basic: Partial<BasicState> & Record<string, string>;
  lifestyle: Partial<LifestyleState> & Record<string, string>;
  indicators: Partial<IndicatorsState> & Record<string, string>;
  derived?: QuestionnaireDerivedPayload;
};

function coerceStringRecord<T extends Record<string, string>>(
  initial: T,
  partial: Record<string, unknown> | undefined,
): T {
  if (!partial || typeof partial !== 'object') return { ...initial };
  const out = { ...initial } as T;
  const o = out as Record<string, string>;
  for (const key of Object.keys(initial) as (keyof T)[]) {
    const k = key as string;
    if (!Object.prototype.hasOwnProperty.call(partial, k)) continue;
    const v = partial[k];
    o[k] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

/** GET /api/user/me/questionnaire：拉取库中已保存问卷并与表单初始结构合并。 */
export async function fetchUserQuestionnaireFromServer(): Promise<{
  basic: BasicState;
  lifestyle: LifestyleState;
  indicators: IndicatorsState;
  derived: QuestionnaireDerivedPayload;
}> {
  const raw = await getJson<UserQuestionnaireResponse>('/api/user/me/questionnaire');
  return {
    basic: coerceStringRecord(initialBasic, raw.basic as Record<string, unknown>),
    lifestyle: coerceStringRecord(initialLifestyle, raw.lifestyle as Record<string, unknown>),
    indicators: coerceStringRecord(initialIndicators, raw.indicators as Record<string, unknown>),
    derived: raw.derived && typeof raw.derived === 'object' ? { ...raw.derived } : {},
  };
}

/**
 * 将当前表单同步到后端 ``user_info``（需已登录且 JWT 在用户端 origin 的 localStorage）。
 * @see POST /api/user/me/questionnaire（与 PUT 等价）
 */
export async function saveUserQuestionnaireToServer(payload: {
  basic: BasicState;
  lifestyle: LifestyleState;
  indicators: IndicatorsState;
  derived?: QuestionnaireDerivedPayload;
}): Promise<{ ok: boolean }> {
  const body: Record<string, unknown> = {
    basic: payload.basic,
    lifestyle: payload.lifestyle,
    indicators: payload.indicators,
  };
  if (payload.derived && Object.keys(payload.derived).length > 0) {
    body.derived = payload.derived;
  }
  return postJson<{ ok: boolean }, Record<string, unknown>>('/api/user/me/questionnaire', body);
}
