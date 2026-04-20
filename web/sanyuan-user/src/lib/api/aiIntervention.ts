import { getJson, getAccessTokenAccount, getAccessTokenSubject } from '@/lib/api';

export type AiInterventionRecommendation = {
  provider?: 'doubao' | 'fallback' | string;
  model?: string;
  reason?: string;
  reasons: string[];
  diet: string[];
  exercise: string[];
  lifestyle: string[];
  // 可参考的文章（来自后端规则召回/推荐，不要求在本页面按此顺序展示）
  supportingArticleIds?: number[];
};

const STORAGE_KEY = 'med_ai_iv_client_v1';

type CachedEnvelope = {
  v: 1;
  accountKey: string;
  savedAt: number;
  data: AiInterventionRecommendation;
};

/** 与 JWT 对齐的缓存分区键（账号优先，否则 sub）。 */
export function aiIvClientCachePartitionKey(): string | null {
  return getAccessTokenAccount() ?? getAccessTokenSubject();
}

/** 读取本标签页 session 中上次成功的 AI 推荐（同用户会话内往返页面可秒开）。 */
export function readAiInterventionClientCache(): AiInterventionRecommendation | null {
  if (typeof window === 'undefined') return null;
  const accountKey = aiIvClientCachePartitionKey();
  if (!accountKey) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as CachedEnvelope;
    if (o?.v !== 1 || o.accountKey !== accountKey || !o.data) return null;
    return o.data;
  } catch {
    return null;
  }
}

export function writeAiInterventionClientCache(data: AiInterventionRecommendation): void {
  if (typeof window === 'undefined') return;
  const accountKey = aiIvClientCachePartitionKey();
  if (!accountKey) return;
  try {
    const env: CachedEnvelope = { v: 1, accountKey, savedAt: Date.now(), data };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(env));
  } catch {
    /* quota / private mode */
  }
}

/** 问卷更新或需强制重算前调用，避免沿用旧推荐。 */
export function clearAiInterventionClientCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function fetchAiInterventionRecommendation(opts?: {
  refresh?: boolean;
}): Promise<AiInterventionRecommendation> {
  const refresh = Boolean(opts?.refresh);
  const path =
    '/api/user/intervention/guides/ai-recommended' + (refresh ? '?refresh=1' : '');
  return getJson<AiInterventionRecommendation>(path, { timeoutMs: 95_000 });
}
