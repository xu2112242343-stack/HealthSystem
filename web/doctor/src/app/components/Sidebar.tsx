import React from 'react';
import {
  Home,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
} from 'lucide-react';
import projectLogo from '@/app/project-logo.png';

type Page = 'dashboard' | 'risk' | 'followup';

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  currentPage: Page;
  onPageChange: (page: Page) => void;
  /** 底部用户条展示名，如「张伟 医生」 */
  userDisplayName: string;
  /** 底部用户条副文案，如科室与职称 */
  userSubtitle: string;
  /** 头像内单字 */
  userAvatarChar: string;
  onOpenPersonalCenter: () => void;
}

export function Sidebar({
  isCollapsed,
  onToggle,
  currentPage,
  onPageChange,
  userDisplayName,
  userSubtitle,
  userAvatarChar,
  onOpenPersonalCenter,
}: SidebarProps) {
  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-white border-r border-gray-200 text-gray-700 transition-all duration-300 ease-in-out z-40 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo and Brand */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
        {!isCollapsed && (
          <div className="flex items-center gap-3">
            <img src={projectLogo} alt="三元智鉴 Logo" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="text-base font-semibold leading-tight text-gray-900">三元智鉴</h1>
              <p className="text-xs text-gray-500 leading-tight">专业医疗辅助系统</p>
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
          <li>
            <button
              onClick={() => onPageChange('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                currentPage === 'dashboard'
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={isCollapsed ? '医生工作台' : ''}
            >
              <Home className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium">医生工作台</span>}
            </button>
          </li>
          <li>
            <button
              onClick={() => onPageChange('risk')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                currentPage === 'risk'
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={isCollapsed ? '疾病分析' : ''}
            >
              <FileText className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm">疾病分析</span>}
            </button>
          </li>
          <li>
            <button
              onClick={() => onPageChange('followup')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                currentPage === 'followup'
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={isCollapsed ? '随访历史' : ''}
            >
              <History className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span className="text-sm">患者随访历史</span>}
            </button>
          </li>
        </ul>
      </nav>

      {/* User entry — opens personal center modal (full row or avatar only when collapsed) */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-gray-200 p-4">
        <button
          type="button"
          onClick={onOpenPersonalCenter}
          className={`w-full flex items-center gap-3 rounded-lg text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
            isCollapsed ? 'justify-center p-0 hover:bg-transparent' : ''
          }`}
          aria-label="打开个人中心"
          title={isCollapsed ? '个人中心' : undefined}
        >
          <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold text-white">{userAvatarChar}</span>
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-gray-900">{userDisplayName}</p>
              <p className="text-xs text-gray-500 truncate">{userSubtitle}</p>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
