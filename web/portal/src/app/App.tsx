import { Activity, Brain, HeartPulse, Lock, Shield, Stethoscope, UserRound } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { RegisterModal } from '@/app/components/RegisterModal'
import { HeroIllustration } from '@/app/components/HeroIllustration'
import { loginRedirectUrl } from '@/lib/appTargets'
import { authenticatePortal } from '@/lib/api/portalAuth'
import type { PortalRole } from '@/lib/sessionPayload'
import projectLogo from '@/app/project-logo.png'

const PLATFORM_FULL_NAME =
  '基于多模态数据的肝病-糖尿病-脑卒中协同预测与个性化健康干预平台'

const ROLE_OPTIONS: { id: PortalRole; label: string; icon: typeof UserRound }[] = [
  { id: 'user', label: '用户', icon: UserRound },
  { id: 'doctor', label: '医生', icon: Stethoscope },
  { id: 'admin', label: '管理员', icon: Shield },
]

function readInitialRole(): PortalRole {
  const q = new URLSearchParams(window.location.search).get('app')
  if (q === 'user' || q === 'doctor' || q === 'admin') return q
  return 'user'
}

export default function App() {
  const REG_PENDING_KEY = 'portal_new_user_pending'
  const [role, setRole] = useState<PortalRole>(() => readInitialRole())
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const active = useMemo(() => ROLE_OPTIONS.find((r) => r.id === role)!, [role])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const name = account.trim()
    const result = await authenticatePortal(role, name, password)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const shouldForceDataCollection =
      role === 'user' &&
      (() => {
        try {
          const pending = sessionStorage.getItem(REG_PENDING_KEY) || ''
          if (!pending) return false
          if (pending.trim().toLowerCase() !== name.trim().toLowerCase()) return false
          sessionStorage.removeItem(REG_PENDING_KEY)
          return true
        } catch {
          return false
        }
      })()
    window.location.href = loginRedirectUrl(role, result.payload, {
      forceDataCollection: shouldForceDataCollection,
    })
  }

  const loginCard = (
    <div className="relative w-full">
      <div className="pointer-events-none absolute inset-x-[-24%] -inset-y-8 flex items-center justify-center opacity-26">
        <HeroIllustration className="w-full max-w-[820px] drop-shadow-[0_8px_24px_rgba(0,0,0,0.18)]" />
      </div>

      <div className="relative rounded-3xl border border-white/55 bg-white/95 shadow-[0_36px_80px_-34px_rgba(2,8,23,0.58)] p-6 sm:p-8 backdrop-blur-xl">
      <div className="mb-4 rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white py-2 px-3 text-center text-sm font-medium">
        欢迎使用三元智鉴健康协同平台
      </div>
      <div className="grid grid-cols-3 gap-2 mb-6">
        {ROLE_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const selected = opt.id === role
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setRole(opt.id)
                setError(null)
                setNotice(null)
              }}
              className={[
                'rounded-xl border px-2 py-3 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
                selected
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--foreground)] shadow-sm'
                  : 'border-[var(--border)] bg-white text-[var(--muted)] hover:border-slate-300 hover:text-[var(--foreground)]',
              ].join(' ')}
            >
              <Icon
                className={`mx-auto size-5 ${selected ? 'text-[var(--accent)]' : 'opacity-70'}`}
                strokeWidth={1.75}
              />
              <div className="mt-1.5 text-xs font-semibold">{opt.label}</div>
            </button>
          )
        })}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <div className="relative">
            <UserRound
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={1.8}
              aria-hidden
            />
            <input
              id="account"
              autoComplete="username"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={role === 'user' ? '用户账号' : role === 'doctor' ? '医生账号' : '管理员账号'}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] pl-10 pr-3.5 py-2.5 text-[var(--foreground)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35 focus:border-[var(--accent)]"
            />
          </div>
        </div>
        <div>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={1.8}
              aria-hidden
            />
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] pl-10 pr-3.5 py-2.5 text-[var(--foreground)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35 focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium py-2.5 transition shadow-sm"
        >
          {`进入${active.label}工作台`}
        </button>
      </form>

      {role === 'user' ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setRegisterOpen(true)
            }}
            className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] underline-offset-2 hover:underline"
          >
            注册用户账号
          </button>
        </div>
      ) : (
        <p className="mt-4 text-center text-sm text-[var(--muted)]">
          {role === 'admin'
            ? '管理员账号由系统开通，不提供自助注册。'
            : '医生账号由管理员或运维开通，本页暂不提供自助注册。'}
        </p>
      )}

      {notice ? (
        <p className="mt-3 text-center text-sm text-emerald-700" role="status">
          {notice}
        </p>
      ) : null}
      </div>
    </div>
  )

  return (
    <div className="h-screen overflow-hidden bg-[var(--background)]">
      <aside className="relative flex h-screen w-full flex-col text-white overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(1200px 600px at 50% -8%, rgba(45,212,191,0.16), transparent 60%), linear-gradient(160deg, var(--brand-hero-from) 0%, var(--brand-hero-via) 46%, var(--brand-hero-to) 100%)`,
          }}
        />
        <div
          className="pointer-events-none absolute -right-24 top-1/4 h-80 w-80 rounded-full bg-teal-400/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-16 bottom-1/4 h-72 w-72 rounded-full bg-cyan-300/15 blur-3xl"
          aria-hidden
        />

        <div
          className="relative z-10 flex flex-col flex-1 justify-center p-4 sm:p-6 lg:p-8 xl:p-10 min-h-0"
          style={{ transform: 'translateY(-4%) scale(1.2)', transformOrigin: 'center center' }}
        >
          <div className="w-full max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-[1fr_minmax(560px,620px)_1fr] gap-10 items-center -translate-y-3">
            <div className="hidden xl:flex items-center justify-center">
              <div className="relative h-[360px] w-[280px]">
                <div className="absolute inset-0 rounded-[32px] border border-white/12 bg-white/[0.04] backdrop-blur-md" />
                <div className="absolute left-7 top-8 size-20 rounded-full border border-emerald-200/30 bg-emerald-300/10 flex items-center justify-center">
                  <HeartPulse className="size-9 text-emerald-100/90" />
                </div>
                <div className="absolute right-8 top-24 size-16 rounded-full border border-cyan-200/30 bg-cyan-300/10 flex items-center justify-center">
                  <Activity className="size-7 text-cyan-100/90" />
                </div>
                <div className="absolute left-12 bottom-20 size-14 rounded-full border border-teal-200/25 bg-teal-300/10 flex items-center justify-center">
                  <Stethoscope className="size-6 text-teal-50/90" />
                </div>
                <div className="absolute left-[82px] top-[96px] h-[2px] w-[120px] bg-gradient-to-r from-emerald-200/40 to-cyan-200/40" />
                <div className="absolute left-[96px] top-[98px] h-[160px] w-[2px] bg-gradient-to-b from-cyan-200/35 to-teal-200/20" />
              </div>
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="mt-3 flex items-center gap-3">
                <img
                  src={projectLogo}
                  alt="三元智鉴项目 Logo"
                  className="h-20 w-20 object-contain drop-shadow-[0_6px_14px_rgba(15,23,42,0.28)]"
                />
                <h1 className="text-5xl xl:text-[3rem] font-semibold tracking-tight leading-[1.1]">
                  三元智鉴
                </h1>
              </div>
              <p className="mt-4 text-sm xl:text-[0.95rem] leading-relaxed text-teal-50/90 max-w-xl">
                {PLATFORM_FULL_NAME}
              </p>

              <div className="mt-5 w-full max-w-[560px] xl:max-w-[620px]">
                {loginCard}
              </div>
            </div>

            <div className="hidden xl:flex items-center justify-center">
              <div className="relative h-[360px] w-[280px]">
                <div className="absolute inset-0 rounded-[32px] border border-white/12 bg-white/[0.04] backdrop-blur-md" />
                <div className="absolute right-7 top-8 size-20 rounded-full border border-indigo-200/30 bg-indigo-300/10 flex items-center justify-center">
                  <Brain className="size-9 text-indigo-100/90" />
                </div>
                <div className="absolute left-8 top-24 size-16 rounded-full border border-cyan-200/30 bg-cyan-300/10 flex items-center justify-center">
                  <Shield className="size-7 text-cyan-100/90" />
                </div>
                <div className="absolute right-12 bottom-20 size-14 rounded-full border border-teal-200/25 bg-teal-300/10 flex items-center justify-center">
                  <UserRound className="size-6 text-teal-50/90" />
                </div>
                <div className="absolute right-[82px] top-[96px] h-[2px] w-[120px] bg-gradient-to-l from-indigo-200/40 to-cyan-200/40" />
                <div className="absolute right-[96px] top-[98px] h-[160px] w-[2px] bg-gradient-to-b from-cyan-200/35 to-teal-200/20" />
              </div>
            </div>
          </div>

        </div>
      </aside>

      {role === 'user' && (
        <RegisterModal
          open={registerOpen}
          role={role}
          onClose={() => setRegisterOpen(false)}
          onRegistered={(name) => {
            setAccount(name)
            setPassword('')
            setNotice('注册成功，请使用刚设置的密码登录。')
            try {
              sessionStorage.setItem(REG_PENDING_KEY, name.trim())
            } catch {
              /* ignore */
            }
          }}
        />
      )}
    </div>
  )
}
