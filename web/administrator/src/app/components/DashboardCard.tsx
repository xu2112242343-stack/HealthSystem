import React from 'react';
import { LucideIcon } from 'lucide-react';

interface DashboardCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
}

export function DashboardCard({
  title,
  value,
  icon: Icon,
  iconColor,
  iconBgColor,
}: DashboardCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow flex flex-col items-center text-center">
      <div className={`${iconBgColor} w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 mb-4`}>
        <Icon className={`w-6 h-6 ${iconColor}`} />
      </div>
      <p className="text-sm text-gray-600 mb-1">{title}</p>
      <h3 className="text-2xl font-semibold text-gray-900">{value}</h3>
    </div>
  );
}
