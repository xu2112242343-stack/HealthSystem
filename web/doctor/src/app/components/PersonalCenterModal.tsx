import React, { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { fetchDoctorProfile, saveDoctorProfile } from '@/lib/api/doctorProfile';

export type AccountVariant = 'doctor' | 'user';

export interface AccountProfileForm {
  name: string;
  phone: string;
  email: string;
}

const CN_MOBILE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBasic(profile: AccountProfileForm): string | null {
  const phone = profile.phone.trim();
  if (!phone) return '请填写手机号';
  if (!CN_MOBILE.test(phone)) return '请输入有效的 11 位中国大陆手机号';

  const email = profile.email.trim();
  if (!email) return '请填写邮箱';
  if (!EMAIL_RE.test(email)) return '邮箱格式不正确';

  return null;
}

function validatePasswords(
  current: string,
  next: string,
  confirm: string,
): string | null {
  const c = current.trim();
  const n = next.trim();
  const cf = confirm.trim();
  const anyFilled = Boolean(c || n || cf);
  if (!anyFilled) return null;
  if (!c) return '修改密码时请填写当前密码';
  if (!n || n.length < 6) return '新密码至少 6 位';
  if (n !== cf) return '两次输入的新密码不一致';
  return null;
}

interface PersonalCenterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: AccountVariant;
  profile: AccountProfileForm;
  onProfileChange: (profile: AccountProfileForm) => void;
  onSaveSuccess?: (profile: AccountProfileForm) => void;
}

export function PersonalCenterModal({
  open,
  onOpenChange,
  variant = 'doctor',
  profile,
  onProfileChange,
  onSaveSuccess,
}: PersonalCenterModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const clearPasswordFields = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, []);

  const resetSensitive = useCallback(() => {
    clearPasswordFields();
    setFeedback(null);
  }, [clearPasswordFields]);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetSensitive();
    onOpenChange(next);
  };

  const description =
    variant === 'doctor'
      ? '编辑医生账户个人资料；如需改密请填写下方密码栏（可留空仅保存资料）。'
      : '编辑用户账户个人资料；如需改密请填写下方密码栏（可留空仅保存资料）。';

  const handleClose = () => {
    handleOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const basicErr = validateBasic(profile);
    if (basicErr) {
      setFeedback({ type: 'error', text: basicErr });
      return;
    }
    const pwdErr = validatePasswords(currentPassword, newPassword, confirmPassword);
    if (pwdErr) {
      setFeedback({ type: 'error', text: pwdErr });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      if (variant === 'doctor') {
        await saveDoctorProfile({
          phone: profile.phone.trim(),
          email: profile.email.trim(),
          ...(currentPassword.trim() || newPassword.trim()
            ? {
                current_password: currentPassword.trim(),
                new_password: newPassword.trim(),
              }
            : {}),
        });
      } else {
        await new Promise((r) => setTimeout(r, 450));
      }
      clearPasswordFields();
      setFeedback({ type: 'success', text: '保存成功' });
      onSaveSuccess?.(profile);
    } catch {
      setFeedback({ type: 'error', text: '保存失败，请稍后重试' });
    } finally {
      setSaving(false);
    }
  };

  const setField = (key: keyof AccountProfileForm, value: string) => {
    onProfileChange({ ...profile, [key]: value });
  };

  useEffect(() => {
    if (!open || variant !== 'doctor') return;
    let cancelled = false;
    setLoadingProfile(true);
    setFeedback(null);
    fetchDoctorProfile()
      .then((p) => {
        if (cancelled) return;
        onProfileChange({
          name: p.name?.trim() || '',
          phone: p.phone?.trim() || '',
          email: p.email?.trim() || '',
        });
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : '加载资料失败';
        setFeedback({ type: 'error', text: msg });
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, variant, onProfileChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-2xl gap-0 p-0 bg-white border-gray-200">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="p-6 pb-4 border-b border-gray-100">
            <DialogHeader className="gap-2 pr-8">
              <DialogTitle className="text-xl font-semibold text-gray-900">个人中心</DialogTitle>
              <DialogDescription className="text-sm text-gray-500 leading-relaxed">
                {description}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-6">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">基本资料</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pcm-name" className="text-gray-700">
                    姓名
                  </Label>
                  <Input
                    id="pcm-name"
                    value={profile.name}
                    readOnly
                    disabled
                    placeholder="数据库姓名"
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pcm-phone" className="text-gray-700">
                    电话 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="pcm-phone"
                    type="tel"
                    inputMode="numeric"
                    value={profile.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                    placeholder="请输入 11 位手机号"
                    autoComplete="tel"
                    disabled={loadingProfile}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pcm-email" className="text-gray-700">
                    邮箱 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="pcm-email"
                    type="email"
                    value={profile.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="请输入邮箱"
                    autoComplete="email"
                    disabled={loadingProfile}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">修改登录密码（选填）</h3>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pcm-cur-pwd" className="text-gray-700">
                    当前密码
                  </Label>
                  <Input
                    id="pcm-cur-pwd"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="请输入当前登录密码"
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pcm-new-pwd" className="text-gray-700">
                    新密码
                  </Label>
                  <Input
                    id="pcm-new-pwd"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="至少 6 位"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pcm-confirm-pwd" className="text-gray-700">
                    确认新密码
                  </Label>
                  <Input
                    id="pcm-confirm-pwd"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入新密码"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>

            {feedback && (
              <p
                role="status"
                className={`text-sm ${feedback.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}
              >
                {feedback.text}
              </p>
            )}
          </div>

          <DialogFooter className="p-6 pt-4 gap-2 sm:gap-3 flex-row justify-end border-t border-gray-100">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
            >
              关闭
            </button>
            <button
              type="submit"
              disabled={saving || loadingProfile}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-gradient-to-r from-teal-500 to-cyan-600 px-5 text-sm font-medium text-white shadow-sm hover:from-teal-600 hover:to-cyan-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
