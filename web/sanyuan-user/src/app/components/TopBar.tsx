import React from 'react';
import { HelpCircle } from 'lucide-react';

interface TopBarProps {
  sidebarCollapsed: boolean;
  currentModule: string;
}

export function TopBar({ sidebarCollapsed, currentModule }: TopBarProps) {

  return (
    <header
      className={`fixed top-0 right-0 h-14 bg-white border-b border-gray-200 z-30 transition-all duration-300 ${
        sidebarCollapsed ? 'left-16' : 'left-64'
      }`}
    >
      <div className="flex h-full items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-lg font-semibold text-gray-900 sm:text-xl">{currentModule}</h2>
        </div>

        <div className="flex items-center gap-4">
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