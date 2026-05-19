import React, { useEffect, useState } from 'react';
import {
  Home,
  ChevronLeft,
  ChevronRight,
  FileText,
  TrendingUp,
  Lightbulb,
  Clock,
} from 'lucide-react';
import { ACCESS_TOKEN_CHANGED_EVENT, getAccessTokenAccount } from '@/lib/api';
import { readStoredSession } from '@/lib/portalSession';
import projectLogo from '@/app/project-logo.png';

const TOKEN_LS = 'med_api_access_token_v1';
const TOKEN_SS = 'med_api_access_token_ss1';

/** 优先用 JWT 里的 account（与 API 一致），避免 sessionStorage 按标签过期导致「侧栏 A、数据 B」。 */
function useSidebarAccount(): string {
  const read = () =>
    (getAccessTokenAccount()?.trim() || readStoredSession()?.account?.trim() || '');
  const [account, setAccount] = useState(read);
  useEffect(() => {
    const sync = () => setAccount(read());
    sync();
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
  return account;
}

function roleLabel(role: string | undefined) {
  if (role === 'doctor') return '医生';
  if (role === 'admin') return '管理员';
  return '用户';
}

function avatarGlyph(account: string) {
  const t = account.trim();
  if (!t) return '用';
  const c = t[0]!;
  return /[a-z]/i.test(c) ? c.toUpperCase() : c;
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  currentPage: string;
  onNavigate: (page: string) => void;
  lockToDataCollection?: boolean;
  onProfileClick?: () => void;
}

export function Sidebar({
  isCollapsed,
  onToggle,
  currentPage,
  onNavigate,
  lockToDataCollection,
  onProfileClick,
}: SidebarProps) {
  const session = readStoredSession();
  const account = useSidebarAccount();
  const primary = account || '—';
  const secondary = roleLabel(session?.role);

  const menuItems = [
    { id: 'home', label: '用户首页', icon: Home },
    { id: 'dataCollection', label: '健康数据', icon: FileText },
    { id: 'riskAssessment', label: '风险评估', icon: TrendingUp },
    { id: 'intervention', label: '干预方案', icon: Lightbulb },
    { id: 'healthLog', label: '健康档案', icon: Clock },
  ];

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-white border-r border-gray-200 text-gray-700 transition-all duration-300 ease-in-out z-40 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo and Brand */}
      <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
        {!isCollapsed && (
          <div className="flex items-center gap-3">
            <img src={projectLogo} alt="三元智鉴 Logo" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="text-base font-semibold leading-tight text-gray-900">三元智鉴</h1>
              <p className="text-xs text-gray-500 leading-tight">用户健康管理平台</p>
            </div>
          </div>
        )}
        {isCollapsed && (
          <img src={projectLogo} alt="三元智鉴 Logo" className="w-10 h-10 object-contain mx-auto" />
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
          {menuItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onNavigate(item.id)}
                disabled={Boolean(lockToDataCollection) && item.id !== 'dataCollection'}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                  currentPage === item.id
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
                    : lockToDataCollection && item.id !== 'dataCollection'
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-700 hover:bg-gray-100'
                }`}
                title={isCollapsed ? item.label : ''}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && <span className="text-sm font-medium">{item.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* User Info at Bottom */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-gray-200 p-4">
        {!isCollapsed ? (
          <button 
            onClick={onProfileClick}
            className="w-full flex items-center gap-3 hover:bg-gray-50 p-2 rounded-lg transition-colors"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-semibold text-white">{avatarGlyph(account)}</span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium truncate text-gray-900" title={primary}>
                {primary}
              </p>
              <p className="text-xs text-gray-500 truncate">{secondary}</p>
            </div>
          </button>
        ) : (
          <button 
            onClick={onProfileClick}
            className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center mx-auto hover:ring-2 hover:ring-emerald-300 transition-all"
          >
            <span className="text-sm font-semibold text-white">{avatarGlyph(account)}</span>
          </button>
        )}
      </div>
    </aside>
  );
}