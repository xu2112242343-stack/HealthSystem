import React from 'react';
import { Search, HelpCircle } from 'lucide-react';

interface TopBarProps {
  sidebarCollapsed: boolean;
  currentModule: string;
}

export function TopBar({ sidebarCollapsed, currentModule }: TopBarProps) {
  return (
    <header
      className={`fixed top-0 right-0 h-16 bg-white border-b border-gray-200 z-30 transition-all duration-300 ${
        sidebarCollapsed ? 'left-16' : 'left-64'
      }`}
    >
      <div className="h-full px-6 flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <h2 className="text-xl font-semibold text-gray-900 truncate">{currentModule}</h2>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              placeholder="搜索用户/医生/系统日志..."
              className="pl-10 pr-4 py-2 w-64 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            />
          </div>

          {/* Help */}
          <button
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="帮助"
          >
            <HelpCircle className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>
    </header>
  );
}