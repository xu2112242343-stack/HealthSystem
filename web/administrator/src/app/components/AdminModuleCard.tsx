import React from 'react';
import { LucideIcon, ChevronRight } from 'lucide-react';

interface SubFunction {
  name: string;
}

interface AdminModuleCardProps {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
  subFunctions: SubFunction[];
  onClick?: () => void;
}

export function AdminModuleCard({
  title,
  icon: Icon,
  iconColor,
  iconBgColor,
  subFunctions,
  onClick,
}: AdminModuleCardProps) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden cursor-pointer group"
      onClick={onClick}
    >
      {/* Header Section */}
      <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${iconBgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-5 h-5 ${iconColor}`} />
            </div>
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-teal-600 group-hover:translate-x-1 transition-all" />
        </div>
      </div>

      {/* Sub Functions List */}
      <div className="p-4">
        <div className="space-y-2">
          {subFunctions.map((func, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-gray-50 transition-colors"
            >
              <div className="w-1.5 h-1.5 bg-teal-500 rounded-full flex-shrink-0"></div>
              <span className="text-sm text-gray-700">{func.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Stats */}
      <div className="px-4 pb-4">
        <div className="pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            共 <span className="font-semibold text-teal-600">{subFunctions.length}</span> 项功能
          </p>
        </div>
      </div>
    </div>
  );
}
