import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
  progressValue?: number;
  trend?: {
    value: string;
    isPositive: boolean;
  };
}

export function StatCard({
  title,
  value,
  icon: Icon,
  iconColor,
  iconBgColor,
  progressValue,
  trend,
}: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-all duration-300">
      <div className="flex items-center justify-between mb-3">
        <div className={`${iconBgColor} w-12 h-12 rounded-xl flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${iconColor}`} />
        </div>
        {trend && (
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              trend.isPositive ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'
            }`}
          >
            {trend.isPositive ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>

      <div className="mb-3">
        <h3 className="text-3xl font-bold text-gray-900 mb-1">{value}</h3>
        <p className="text-sm text-gray-600">{title}</p>
      </div>

      {progressValue !== undefined && (
        <div className="relative">
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${iconBgColor.replace('bg-', 'bg-gradient-to-r from-')} ${iconColor.replace('text-', 'to-')} rounded-full transition-all duration-500`}
              style={{ width: `${progressValue}%` }}
            />
          </div>
          <span className="absolute right-0 -top-5 text-xs font-medium text-gray-600">
            {progressValue}%
          </span>
        </div>
      )}
    </div>
  );
}
