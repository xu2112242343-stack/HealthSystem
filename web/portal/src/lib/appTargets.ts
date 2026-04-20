import type { PortalRole } from './sessionPayload'

const trimSlash = (s: string) => s.replace(/\/+$/, '')

function baseForRole(role: PortalRole): string {
  const defaults: Record<PortalRole, string> = {
    user: 'http://localhost:5171',
    doctor: 'http://localhost:5172',
    admin: 'http://localhost:5173',
  }
  const envKey =
    role === 'user'
      ? 'VITE_APP_USER_URL'
      : role === 'doctor'
        ? 'VITE_APP_DOCTOR_URL'
        : 'VITE_APP_ADMIN_URL'
  const raw = (import.meta.env as Record<string, string | undefined>)[envKey]
  return trimSlash(raw || defaults[role])
}

export function loginRedirectUrl(
  role: PortalRole,
  payloadJson: string,
  options?: { forceDataCollection?: boolean },
): string {
  const base = baseForRole(role)
  const url = new URL(`${base}/`)
  /** payload 内可含 accessToken（由门户登录接口写入），子应用解析后写入本域 localStorage */
  url.searchParams.set('med_auth', payloadJson)
  if (role === 'user' && options?.forceDataCollection) {
    url.searchParams.set('first_fill', '1')
  }
  return url.toString()
}
