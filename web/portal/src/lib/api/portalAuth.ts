import { ApiError, postJson, setStoredAccessToken } from '@/lib/api';
import type { PortalRole, RegistrableRole } from '@/lib/sessionPayload';

export type PortalLoginResult = { ok: true; payload: string } | { ok: false; message: string };

/**
 * 门户登录：必须请求后端，账户与密码以数据库为准。
 */
export async function authenticatePortal(
  role: PortalRole,
  account: string,
  password: string,
): Promise<PortalLoginResult> {
  const name = account.trim();
  try {
    const res = await postJson<{
      token?: string;
      session: {
        role: PortalRole
        account: string
        userId?: number
        licenseCode?: string
        iat: number
      };
    }>('/api/portal/auth/login', { role, account: name, password });

    if (res.token) setStoredAccessToken(res.token);
    /** 子应用与门户不同源：把 JWT 放进 med_auth 的 JSON 里，避免单独 med_token 在部分浏览器/代理下异常 */
    const payload = {
      ...res.session,
      ...(typeof res.token === 'string' && res.token ? { accessToken: res.token } : {}),
    };
    return { ok: true, payload: JSON.stringify(payload) };
  } catch (e) {
    if (e instanceof ApiError) {
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : '登录失败，请确认后端已启动且地址正确',
    };
  }
}

export type PortalRegisterResult = { ok: true } | { ok: false; message: string };

/** 用户/医生注册写入数据库（医生需传执照号、姓名） */
export async function registerPortal(
  role: RegistrableRole,
  account: string,
  password: string,
  doctorExtra?: { licenseCode: string; doctorName: string },
): Promise<PortalRegisterResult> {
  try {
    await postJson<{ ok: boolean }>('/api/portal/auth/register', {
      role,
      account: account.trim(),
      password,
      license_code: role === 'doctor' ? doctorExtra?.licenseCode?.trim() : undefined,
      doctor_name: role === 'doctor' ? doctorExtra?.doctorName?.trim() : undefined,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError) {
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : '注册失败，请确认后端已启动且地址正确',
    };
  }
}
