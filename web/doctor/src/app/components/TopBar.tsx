import React from 'react';
import { Bell, HelpCircle } from 'lucide-react';

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
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-gray-900">{currentModule}</h2>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-4">
          {/* Notifications */}
          <button
            className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="通知"
          >
            <Bell className="w-5 h-5 text-gray-600" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>

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