import React, { useState } from 'react';
import {
  Home,
  ChevronLeft,
  ChevronRight,
  Stethoscope,
  Users,
  Database,
} from 'lucide-react';
import projectLogo from '@/app/project-logo.png';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onNavigateHome?: () => void;
  onNavigateToModule?: (moduleIndex: number) => void;
  currentModuleIndex?: number | null;
}

export function Sidebar({
  isCollapsed,
  onToggle,
  onNavigateHome,
  onNavigateToModule,
  currentModuleIndex,
}: SidebarProps) {
  const [personalCenterOpen, setPersonalCenterOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileAge, setProfileAge] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [formMsg, setFormMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const resetPasswordForm = () => {
    setCurrentPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setFormMsg(null);
  };

  const handlePersonalCenterOpenChange = (open: boolean) => {
    setPersonalCenterOpen(open);
    if (!open) resetPasswordForm();
  };

  const handleSavePersonalCenter = (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg(null);

    if (!profileName.trim()) {
      setFormMsg({ type: 'err', text: '请填写姓名。' });
      return;
    }
    if (profileAge.trim()) {
      const ageNum = parseInt(profileAge.trim(), 10);
      if (!Number.isFinite(ageNum) || ageNum < 1 || ageNum > 150) {
        setFormMsg({ type: 'err', text: '年龄请输入 1–150 之间的有效数字。' });
        return;
      }
    }
    if (!profilePhone.trim()) {
      setFormMsg({ type: 'err', text: '请填写电话。' });
      return;
    }
    if (!/^1\d{10}$/.test(profilePhone.trim().replace(/\s/g, ''))) {
      setFormMsg({ type: 'err', text: '请输入 11 位手机号码。' });
      return;
    }
    if (!profileEmail.trim()) {
      setFormMsg({ type: 'err', text: '请填写邮箱。' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileEmail.trim())) {
      setFormMsg({ type: 'err', text: '邮箱格式不正确。' });
      return;
    }

    const pwdTouched = currentPwd.trim() || newPwd.trim() || confirmPwd.trim();
    if (pwdTouched) {
      if (!currentPwd.trim() || !newPwd.trim() || !confirmPwd.trim()) {
        setFormMsg({ type: 'err', text: '修改密码时请填写当前密码、新密码与确认密码。' });
        return;
      }
      if (newPwd !== confirmPwd) {
        setFormMsg({ type: 'err', text: '新密码与确认密码不一致。' });
        return;
      }
      if (newPwd.length < 8) {
        setFormMsg({ type: 'err', text: '新密码长度至少 8 位。' });
        return;
      }
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
    }

    const parts = ['个人资料已保存'];
    if (pwdTouched) parts.push('登录密码已更新');
    setFormMsg({ type: 'ok', text: parts.join('，') + '。' });
  };

  const profileTriggerClass =
    'w-full flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 text-left outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-teal-500/30';

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-white border-r border-gray-200 text-gray-700 transition-all duration-300 ease-in-out z-40 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo and Brand */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
        {!isCollapsed && (
          <div className="flex items-center gap-3 cursor-pointer" onClick={onNavigateHome}>
            <img src={projectLogo} alt="三元智鉴 Logo" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="text-base font-semibold leading-tight text-gray-900">三元智鉴</h1>
              <p className="text-xs text-gray-500 leading-tight">管理员后台系统</p>
            </div>
          </div>
        )}
        {isCollapsed && (
          <img
            src={projectLogo}
            alt="三元智鉴 Logo"
            className="w-10 h-10 object-contain mx-auto cursor-pointer"
            onClick={onNavigateHome}
          />
        )}
      </div>

      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 w-6 h-6 bg-white border border-gray-200 rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
        aria-label={isCollapsed ? '展开侧边栏' : '收缩侧边栏'}
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 text-gray-600" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        )}
      </button>

      {/* Navigation Menu */}
      <nav className="mt-4">
        <ul className="space-y-1 px-3">
          <li>
            <button
              onClick={onNavigateHome}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                currentModuleIndex === null
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={isCollapsed ? '管理员工作台' : ''}
            >
              <Home className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium">管理员工作台</span>}
            </button>
          </li>
          <li>
            <button
              onClick={() => onNavigateToModule?.(0)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                currentModuleIndex === 0
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={isCollapsed ? '医生账户管理' : ''}
            >
              <Stethoscope className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm">医生账户管理</span>}
            </button>
          </li>
          <li>
            <button
              onClick={() => onNavigateToModule?.(1)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                currentModuleIndex === 1
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={isCollapsed ? '用户账户管理' : ''}
            >
              <Users className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm">用户账户管理</span>}
            </button>
          </li>
          <li>
            <button
              onClick={() => onNavigateToModule?.(2)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                currentModuleIndex === 2
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={isCollapsed ? '医疗数据库管理' : ''}
            >
              <Database className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm">医疗数据库管理</span>}
            </button>
          </li>
        </ul>
      </nav>

      {/* User / 个人中心：点击即打开个人中心 */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-gray-200 p-3">
        <button
          type="button"
          className={profileTriggerClass}
          title="个人中心"
          aria-label="打开个人中心"
          onClick={() => setPersonalCenterOpen(true)}
        >
          <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold text-white">管</span>
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-gray-900">管理员</p>
              <p className="text-xs text-gray-500 truncate">三元智鉴 · 管理端</p>
            </div>
          )}
        </button>
      </div>

      <Dialog open={personalCenterOpen} onOpenChange={handlePersonalCenterOpenChange}>
        <DialogContent className="sm:max-w-md z-[70]">
          <DialogHeader>
            <DialogTitle>个人中心</DialogTitle>
            <DialogDescription>编辑个人资料；如需改密请填写下方密码栏（可留空仅保存资料）。</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSavePersonalCenter} className="space-y-4">
            <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4 space-y-4">
              <p className="text-sm font-medium text-gray-900">基本资料</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sidebar-profile-name">姓名</Label>
                  <Input
                    id="sidebar-profile-name"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="请输入姓名"
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sidebar-profile-age">年龄</Label>
                  <Input
                    id="sidebar-profile-age"
                    type="number"
                    min={1}
                    max={150}
                    value={profileAge}
                    onChange={(e) => setProfileAge(e.target.value)}
                    placeholder="请输入年龄"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sidebar-profile-phone">电话</Label>
                  <Input
                    id="sidebar-profile-phone"
                    type="tel"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    placeholder="请输入手机号码"
                    autoComplete="tel"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sidebar-profile-email">邮箱</Label>
                  <Input
                    id="sidebar-profile-email"
                    type="email"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    placeholder="请输入邮箱"
                    autoComplete="email"
                  />
                </div>
              </div>
            </div>

            <p className="text-sm font-medium text-gray-900">修改登录密码（选填）</p>
            <div className="space-y-2">
              <Label htmlFor="sidebar-current-pwd">当前密码</Label>
              <Input
                id="sidebar-current-pwd"
                type="password"
                autoComplete="current-password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                placeholder="请输入当前登录密码"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sidebar-new-pwd">新密码</Label>
              <Input
                id="sidebar-new-pwd"
                type="password"
                autoComplete="new-password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="至少 8 位"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sidebar-confirm-pwd">确认新密码</Label>
              <Input
                id="sidebar-confirm-pwd"
                type="password"
                autoComplete="new-password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="再次输入新密码"
              />
            </div>
            {formMsg && (
              <p
                className={`text-sm ${formMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
                role="status"
              >
                {formMsg.text}
              </p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => handlePersonalCenterOpenChange(false)}>
                关闭
              </Button>
              <Button
                type="submit"
                className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
              >
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
