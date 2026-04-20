const TOKEN_KEY = 'med_api_access_token_v1';
/** 每个标签页独立 JWT（sessionStorage）；localStorage 仅兼容旧版本兜底读取。 */
const TOKEN_KEY_SESSION = 'med_api_access_token_ss1';

/** 写入/清除 JWT 后派发，便于各页按「当前用户」重新拉库（同标签页 storage 事件不会触发）。 */
export const ACCESS_TOKEN_CHANGED_EVENT = 'med-access-token-changed';

function dispatchAccessTokenChanged(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(ACCESS_TOKEN_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** 解码 JWT payload（不校验签名，仅供前端展示/对齐会话）。 */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const json = atob(b64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** JWT ``sub``，如 ``user:12``。 */
export function getAccessTokenSubject(): string | null {
  const p = decodeJwtPayload(getStoredAccessToken());
  const sub = p?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

/** JWT 内签发时的登录账号（与后端 ``login_name`` 一致），用于与会话侧栏对齐。 */
export function getAccessTokenAccount(): string | null {
  const p = decodeJwtPayload(getStoredAccessToken());
  const a = p?.account;
  return typeof a === 'string' && a.length > 0 ? a : null;
}

export function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const ss = window.sessionStorage.getItem(TOKEN_KEY_SESSION);
    if (ss && ss.length > 0) return ss;
    /** 兼容历史：曾写入 localStorage，迁移期仍可读。 */
    const ls = window.localStorage.getItem(TOKEN_KEY);
    if (ls && ls.length > 0) return ls;
    return null;
  } catch {
    return null;
  }
}

/** 登录成功后由业务代码写入；登出时传 null */
export function setStoredAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token == null || token === '') {
      try {
        window.localStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
      try {
        window.sessionStorage.removeItem(TOKEN_KEY_SESSION);
      } catch {
        /* ignore */
      }
      dispatchAccessTokenChanged();
      return;
    }
    /** 为支持「不同页面登录不同账户」，优先且实际使用 sessionStorage。 */
    try {
      window.sessionStorage.setItem(TOKEN_KEY_SESSION, token);
    } catch {
      /* ignore */
    }
    /** 仅作为兼容兜底保留一份，不参与优先读取。 */
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore quota / private mode */
    }
    dispatchAccessTokenChanged();
  } catch {
    /* ignore */
  }
}

export function getAuthHeaders(): Record<string, string> {
  const t = getStoredAccessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
