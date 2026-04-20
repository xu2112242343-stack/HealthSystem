import { getAccessTokenAccount, getAccessTokenSubject } from '@/lib/api';

const SNAPSHOT_PREFIX = 'sanyuan_questionnaire_snapshot_v1';
const COMPLETION_PREFIX = 'sanyuan_questionnaire_completion_v1';

/** 旧版全局键（所有账号共用），会导致多标签多账户串进度，仅保留用于迁移与清理 */
export const LEGACY_QUESTIONNAIRE_SNAPSHOT_KEY = 'sanyuan_questionnaire_snapshot_v1';
export const LEGACY_QUESTIONNAIRE_COMPLETION_KEY = 'sanyuan_questionnaire_completion_v1';

function sanitizeScopeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9:_@-]/g, '_');
}

/**
 * JWT 在 sessionStorage 中按标签页隔离，但问卷草稿曾写在固定 localStorage 键上，多开标签会共用一份进度。
 * 此处用 ``sub``（或回退 ``account``）为 localStorage 分桶，与当前标签页的 token 一致。
 */
export function getQuestionnaireStorageScopeId(): string {
  const sub = getAccessTokenSubject();
  if (sub) return sanitizeScopeSegment(sub);
  const acc = getAccessTokenAccount();
  if (acc) return `acc:${sanitizeScopeSegment(acc)}`;
  return '__guest__';
}

export function getScopedQuestionnaireSnapshotKey(): string {
  return `${SNAPSHOT_PREFIX}:${getQuestionnaireStorageScopeId()}`;
}

export function getScopedQuestionnaireCompletionKey(): string {
  return `${COMPLETION_PREFIX}:${getQuestionnaireStorageScopeId()}`;
}

export function clearLegacyQuestionnaireLocalStorage(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(LEGACY_QUESTIONNAIRE_SNAPSHOT_KEY);
    window.localStorage.removeItem(LEGACY_QUESTIONNAIRE_COMPLETION_KEY);
  } catch {
    /* ignore */
  }
}
