import { setStoredAccessToken } from '@/lib/api'

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

export function consumeAuthFromUrl(): PortalSession | null {
  const u = new URL(window.location.href)
  const raw = u.searchParams.get(PARAM_KEY)
  let session: PortalSession | null = null

  if (raw) {
    try {
      const rec = JSON.parse(raw) as Record<string, unknown>
      const embedded = rec.accessToken
      if (typeof embedded === 'string' && embedded.length > 0) {
        setStoredAccessToken(embedded)
      }
      delete rec.accessToken
      session = parseSession(JSON.stringify(rec))
      if (session) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
      }
    } catch {
      session = null
    }
    u.searchParams.delete(PARAM_KEY)
  }

  const legacyTok = u.searchParams.get(TOKEN_PARAM)
  if (legacyTok) {
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
  if (s?.role === expected) return true
  sessionStorage.removeItem(STORAGE_KEY)
  const normalized = portalBase.replace(/\/$/, '')
  const url = new URL(`${normalized}/`)
  url.searchParams.set('app', expected)
  window.location.assign(url.toString())
  return false
}
