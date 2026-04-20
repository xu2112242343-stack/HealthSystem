import React, { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { cn } from "@/app/components/ui/utils";
import { getStoredAccessToken } from "@/lib/api";
import { fetchUserProfile, saveUserProfile } from "@/lib/api/userProfile";

export type ProfileAccountVariant = "user" | "doctor";

export type ProfileSavePayload = {
  name: string;
  phone: string;
  email: string;
  passwordChange?: {
    currentPassword: string;
    newPassword: string;
  };
};

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 用户端默认「个人中心」，医生端可用「医生账户」 */
  accountVariant?: ProfileAccountVariant;
  /** 提交资料（及可选改密）；未传时在前端校验通过后模拟成功 */
  onSave?: (payload: ProfileSavePayload) => Promise<void>;
}

const CN_MOBILE = /^1\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBasic(name: string, phone: string, email: string): string | null {
  if (!name.trim()) return "请填写姓名";
  if (!phone.trim()) return "请填写电话";
  if (!CN_MOBILE.test(phone.trim())) return "请输入 11 位大陆手机号";
  if (!email.trim()) return "请填写邮箱";
  if (!EMAIL_RE.test(email.trim())) return "邮箱格式不正确";
  return null;
}

function validatePasswords(
  current: string,
  next: string,
  confirm: string,
): string | null {
  const any = current.length > 0 || next.length > 0 || confirm.length > 0;
  if (!any) return null;
  if (!current) return "修改密码时请填写当前密码";
  if (!next) return "请填写新密码";
  if (!confirm) return "请再次输入新密码";
  if (next.length < 8) return "新密码至少 8 位";
  if (next !== confirm) return "两次输入的新密码不一致";
  return null;
}

const fieldClass =
  "rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 placeholder:text-gray-400";

export function ProfileModal({
  isOpen,
  onClose,
  accountVariant = "user",
  onSave,
}: ProfileModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const title = accountVariant === "doctor" ? "医生账户" : "个人中心";

  const resetSensitive = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFeedback(null);
  }, []);

  const handleClose = useCallback(() => {
    resetSensitive();
    onClose();
  }, [onClose, resetSensitive]);

  useEffect(() => {
    if (!isOpen) resetSensitive();
  }, [isOpen, resetSensitive]);

  useEffect(() => {
    if (isOpen) setFeedback(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || accountVariant !== "user") return;
    const token = getStoredAccessToken();
    if (!token) return;
    let cancelled = false;
    setProfileLoading(true);
    (async () => {
      try {
        const p = await fetchUserProfile();
        if (cancelled) return;
        setName(p.name?.trim() ? p.name : "");
        setPhone(p.phone?.trim() ? p.phone : "");
        setEmail(p.email?.trim() ? p.email : "");
      } catch {
        if (!cancelled) {
          setFeedback({ kind: "error", text: "无法加载资料，请确认已登录" });
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, accountVariant]);

  const handleSave = async () => {
    setFeedback(null);
    const basicErr = validateBasic(name, phone, email);
    if (basicErr) {
      setFeedback({ kind: "error", text: basicErr });
      return;
    }
    const pwdErr = validatePasswords(currentPassword, newPassword, confirmPassword);
    if (pwdErr) {
      setFeedback({ kind: "error", text: pwdErr });
      return;
    }

    const payload: ProfileSavePayload = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
    };
    const anyPwd =
      currentPassword.length > 0 || newPassword.length > 0 || confirmPassword.length > 0;
    if (anyPwd) {
      payload.passwordChange = {
        currentPassword,
        newPassword,
      };
    }

    setSaving(true);
    try {
      if (onSave) {
        await onSave(payload);
      } else if (accountVariant === "user") {
        await saveUserProfile({
          name: payload.name,
          phone: payload.phone,
          email: payload.email,
          ...(payload.passwordChange && {
            current_password: payload.passwordChange.currentPassword,
            new_password: payload.passwordChange.newPassword,
          }),
        });
      } else {
        await new Promise((r) => setTimeout(r, 400));
      }
      setFeedback({ kind: "success", text: "保存成功" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失败，请稍后重试";
      setFeedback({ kind: "error", text: msg });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative border-b border-gray-100 px-6 pb-4 pt-6 pr-14">
          <button
            type="button"
            onClick={handleClose}
            className="absolute right-4 top-4 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 id="profile-modal-title" className="text-xl font-bold text-gray-900">
            {title}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            编辑个人资料；如需改密请填写下方密码栏（可留空仅保存资料）。
          </p>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div className="rounded-xl border border-gray-200 bg-gray-100/80 p-4 sm:p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">基本资料</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="profile-name" className="text-gray-700">
                  姓名
                </Label>
                <Input
                  id="profile-name"
                  className={fieldClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="请输入姓名"
                  autoComplete="name"
                  disabled={profileLoading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-phone" className="text-gray-700">
                  电话
                </Label>
                <Input
                  id="profile-phone"
                  type="tel"
                  className={fieldClass}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="请输入 11 位手机号"
                  autoComplete="tel"
                  disabled={profileLoading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-email" className="text-gray-700">
                  邮箱
                </Label>
                <Input
                  id="profile-email"
                  type="email"
                  className={fieldClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="请输入邮箱"
                  autoComplete="email"
                  disabled={profileLoading}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">修改登录密码（选填）</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-cur-pwd" className="text-gray-700">
                  当前密码
                </Label>
                <Input
                  id="profile-cur-pwd"
                  type="password"
                  className={fieldClass}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="请输入当前登录密码"
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-new-pwd" className="text-gray-700">
                  新密码
                </Label>
                <Input
                  id="profile-new-pwd"
                  type="password"
                  className={fieldClass}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 8 位"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-confirm-pwd" className="text-gray-700">
                  确认新密码
                </Label>
                <Input
                  id="profile-confirm-pwd"
                  type="password"
                  className={fieldClass}
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
              className={cn(
                "text-sm",
                feedback.kind === "success" ? "text-emerald-600" : "text-red-600",
              )}
              role="status"
            >
              {feedback.text}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-50"
            >
              关闭
            </button>
            <button
              type="button"
              disabled={saving || profileLoading}
              onClick={handleSave}
              className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
