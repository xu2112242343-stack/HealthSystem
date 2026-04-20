import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { registerPortal } from '@/lib/api/portalAuth'
import type { RegistrableRole } from '@/lib/sessionPayload'

interface RegisterModalProps {
  open: boolean
  role: RegistrableRole
  onClose: () => void
  onRegistered: (account: string) => void
}

const ROLE_LABEL: Record<RegistrableRole, string> = {
  user: '用户',
  doctor: '医生',
}

export function RegisterModal({ open, role, onClose, onRegistered }: RegisterModalProps) {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [licenseCode, setLicenseCode] = useState('')
  const [doctorName, setDoctorName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const resetAndClose = () => {
    setAccount('')
    setPassword('')
    setConfirm('')
    setLicenseCode('')
    setDoctorName('')
    setError(null)
    setSubmitting(false)
    onClose()
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    if (role === 'doctor') {
      if (!licenseCode.trim()) {
        setError('请填写医师执照号')
        return
      }
      if (!doctorName.trim()) {
        setError('请填写医生姓名')
        return
      }
    }
    setSubmitting(true)
    const res = await registerPortal(
      role,
      account,
      password,
      role === 'doctor' ? { licenseCode, doctorName } : undefined,
    )
    setSubmitting(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    const name = account.trim()
    onRegistered(name)
    setAccount('')
    setPassword('')
    setConfirm('')
    setLicenseCode('')
    setDoctorName('')
    setError(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="register-title">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        aria-label="关闭"
        onClick={resetAndClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="register-title" className="text-lg font-semibold text-[var(--foreground)]">
              注册{ROLE_LABEL[role]}账号
            </h2>
            <p className="text-sm text-[var(--muted)] mt-1">
              账号将写入服务器数据库；管理员账号由系统分配，不提供自助注册。
            </p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--foreground)]"
            aria-label="关闭注册"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="reg-account" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
              账号
            </label>
            <input
              id="reg-account"
              autoComplete="username"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={role === 'doctor' ? '设置医生登录账号' : '设置登录账号'}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-[var(--foreground)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35 focus:border-[var(--accent)]"
            />
          </div>
          {role === 'doctor' ? (
            <>
              <div>
                <label htmlFor="reg-license" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                  医师执照号 *
                </label>
                <input
                  id="reg-license"
                  value={licenseCode}
                  onChange={(e) => setLicenseCode(e.target.value)}
                  placeholder="与数据库主键一致，不可重复"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-[var(--foreground)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35 focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label htmlFor="reg-doc-name" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                  医生姓名 *
                </label>
                <input
                  id="reg-doc-name"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  placeholder="真实姓名"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-[var(--foreground)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35 focus:border-[var(--accent)]"
                />
              </div>
            </>
          ) : null}
          <div>
            <label htmlFor="reg-password" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
              密码
            </label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-[var(--foreground)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35 focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label htmlFor="reg-confirm" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
              确认密码
            </label>
            <input
              id="reg-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再次输入密码"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-[var(--foreground)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35 focus:border-[var(--accent)]"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={resetAndClose}
              disabled={submitting}
              className="flex-1 rounded-xl border border-[var(--border)] bg-white py-2.5 text-sm font-medium text-[var(--foreground)] hover:bg-slate-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium py-2.5 disabled:opacity-50"
            >
              {submitting ? '提交中…' : '注册'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
