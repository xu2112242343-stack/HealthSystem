import {
  ACCESS_TOKEN_CHANGED_EVENT,
  decodeJwtPayload,
  getAccessTokenAccount,
  getStoredAccessToken,
  setStoredAccessToken,
} from '@/lib/api'
import { clearLegacyQuestionnaireLocalStorage } from '@/lib/questionnaireStorageKeys'

export type PortalRole = 'user' | 'doctor' | 'admin'

const STORAGE_KEY = 'med_portal_session'
const PARAM_KEY = 'med_auth'
const TOKEN_PARAM = 'med_token'

export interface PortalSession {
  role: PortalRole
  account: string
  iat: number
}

function parseSession(raw: string | null): PortalSession | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return null
    const rec = o as Record<string, unknown>
    const role = rec.role
    const account = rec.account
    if (
      (role === 'user' || role === 'doctor' || role === 'admin') &&
      typeof account === 'string' &&
      account.length > 0
    ) {
      return {
        role,
        account,
        iat: typeof rec.iat === 'number' ? rec.iat : Date.now(),
      }
    }
  } catch {
    return null
  }
  return null
}

export function readStoredSession(): PortalSession | null {
  return parseSession(sessionStorage.getItem(STORAGE_KEY))
}

/**
 * JWT 存在 localStorage（全标签共享），会话在 sessionStorage（每标签独立）。
 * 另一标签页换号登录后，本标签可能仍显示旧账号名，但请求已带新 JWT —— 表现为「名字与数据对不上」。
 * 以 JWT 为准覆盖会话中的 account，并派发事件让各页重新拉数。
 */
export function syncSessionWithJwtForUser(): void {
  const s = readStoredSession()
  const tok = getStoredAccessToken()
  if (!tok || s?.role !== 'user') return
  const p = decodeJwtPayload(tok)
  if (!p || p.role !== 'user') return
  const jwtAcc = getAccessTokenAccount()
  if (!jwtAcc) return
  if (s.account.trim().toLowerCase() === jwtAcc.trim().toLowerCase()) return
  try {
    const next: PortalSession = { ...s, account: jwtAcc }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    /** 问卷已按 JWT 分桶存 localStorage，无需清空当前用户草稿；仅对齐会话展示名 */
    window.dispatchEvent(new CustomEvent(ACCESS_TOKEN_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

export function consumeAuthFromUrl(): PortalSession | null {
  const u = new URL(window.location.href)
  const raw = u.searchParams.get(PARAM_KEY)
  let session: PortalSession | null = null

  if (raw) {
    try {
      let rec: Record<string, unknown> | null = null
      try {
        rec = JSON.parse(raw) as Record<string, unknown>
      } catch {
        try {
          rec = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>
        } catch {
          rec = null
        }
      }
      if (rec) {
        const embedded = rec.accessToken
        /** 必须与 accessToken 同时写入会话：若 URL 里只有 account 没有 token，仍用旧 JWT 会拉错用户数据。 */
        if (typeof embedded === 'string' && embedded.length > 0) {
          clearLegacyQuestionnaireLocalStorage()
          setStoredAccessToken(embedded)
          delete rec.accessToken
          session = parseSession(JSON.stringify(rec))
          if (session) {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
          }
        }
      } else {
        session = null
      }
    } catch {
      session = null
    }
    u.searchParams.delete(PARAM_KEY)
  }

  /** 旧版门户曾单独传 med_token，仍兼容 */
  const legacyTok = u.searchParams.get(TOKEN_PARAM)
  if (legacyTok) {
    clearLegacyQuestionnaireLocalStorage()
    setStoredAccessToken(legacyTok)
    u.searchParams.delete(TOKEN_PARAM)
  }

  if (raw || legacyTok) {
    window.history.replaceState({}, '', u.pathname + u.search + u.hash)
  }

  return session
}

export function ensurePortalRole(expected: PortalRole, portalBase: string): boolean {
  consumeAuthFromUrl()
  const s = readStoredSession()
  if (s?.role !== expected) {
    sessionStorage.removeItem(STORAGE_KEY)
    setStoredAccessToken(null)
    const normalized = portalBase.replace(/\/$/, '')
    const url = new URL(`${normalized}/`)
    url.searchParams.set('app', expected)
    window.location.assign(url.toString())
    return false
  }
  /** 仅有会话、没有 JWT 时无法调写库接口，强制回门户重新登录以带上 accessToken */
  if (expected === 'user' && !getStoredAccessToken()) {
    sessionStorage.removeItem(STORAGE_KEY)
    setStoredAccessToken(null)
    const normalized = portalBase.replace(/\/$/, '')
    const url = new URL(`${normalized}/`)
    url.searchParams.set('app', 'user')
    window.location.assign(url.toString())
    return false
  }
  if (expected === 'user') {
    syncSessionWithJwtForUser()
  }
  return true
}
