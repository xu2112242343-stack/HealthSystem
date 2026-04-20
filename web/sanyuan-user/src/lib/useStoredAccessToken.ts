import { useEffect, useState } from 'react';
import { ACCESS_TOKEN_CHANGED_EVENT, getStoredAccessToken } from '@/lib/api';

const TOKEN_LS = 'med_api_access_token_v1';
const TOKEN_SS = 'med_api_access_token_ss1';

/**
 * 当前内存中的 JWT 字符串（与 localStorage / sessionStorage 同步）。
 * 换账号登录后 ``setStoredAccessToken`` 会触发更新，用于按用户重新请求 GET /api/user/me/questionnaire 等。
 */
export function useStoredAccessToken(): string | null {
  const [token, setToken] = useState(() =>
    typeof window === 'undefined' ? null : getStoredAccessToken(),
  );

  useEffect(() => {
    const sync = () => setToken(getStoredAccessToken());
    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_LS || e.key === TOKEN_SS) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return token;
}
