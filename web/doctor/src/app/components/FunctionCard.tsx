import React from 'react';
import { LucideIcon } from 'lucide-react';

interface FunctionCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
  isHighlighted?: boolean;
  badge?: string;
}

export function FunctionCard({
  title,
  description,
  icon: Icon,
  iconColor,
  iconBgColor,
  isHighlighted = false,
  badge,
}: FunctionCardProps) {
  return (
    <button
      className={`relative p-6 bg-white rounded-xl border-2 hover:shadow-lg transition-all duration-300 text-left group ${
        isHighlighted
          ? 'border-teal-500 shadow-md'
          : 'border-gray-200 hover:border-teal-300'
      }`}
    >
      {badge && (
        <span className="absolute top-4 right-4 px-2 py-1 text-xs font-medium text-teal-700 bg-teal-50 rounded-full border border-teal-200">
          {badge}
        </span>
      )}
      
      <div className="flex flex-col items-center text-center">
        <div
          className={`${iconBgColor} ${
            isHighlighted ? 'w-20 h-20' : 'w-16 h-16'
          } rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}
        >
          <Icon
            className={`${iconColor} ${isHighlighted ? 'w-10 h-10' : 'w-8 h-8'}`}
          />
        </div>
        
        <h3
          className={`font-semibold text-gray-900 mb-2 ${
            isHighlighted ? 'text-lg' : 'text-base'
          }`}
        >
          {title}
        </h3>
        
        <p className="text-sm text-gray-600">{description}</p>
      </div>
    </button>
  );
}
