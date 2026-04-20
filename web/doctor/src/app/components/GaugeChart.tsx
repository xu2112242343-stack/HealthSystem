import React from 'react';

interface GaugeChartProps {
  value: number;
  max?: number;
  title: string;
  subtitle?: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  color?: string;
}

export function GaugeChart({
  value,
  max = 100,
  title,
  subtitle,
  trend,
  color = 'teal',
}: GaugeChartProps) {
  const percentage = (value / max) * 100;
  const rotation = (percentage / 100) * 180 - 90;

  const getColorClasses = (colorName: string) => {
    const colors = {
      teal: {
        gradient: 'from-teal-400 to-teal-600',
        text: 'text-teal-600',
        bg: 'bg-teal-50',
      },
      emerald: {
        gradient: 'from-emerald-400 to-emerald-600',
        text: 'text-emerald-600',
        bg: 'bg-emerald-50',
      },
      cyan: {
        gradient: 'from-cyan-400 to-cyan-600',
        text: 'text-cyan-600',
        bg: 'bg-cyan-50',
      },
      orange: {
        gradient: 'from-orange-400 to-orange-600',
        text: 'text-orange-600',
        bg: 'bg-orange-50',
      },
      red: {
        gradient: 'from-red-400 to-red-600',
        text: 'text-red-600',
        bg: 'bg-red-50',
      },
    };
    return colors[colorName as keyof typeof colors] || colors.teal;
  };

  const colorClasses = getColorClasses(color);

  return (
    <div className="flex flex-col items-center">
      {/* Gauge Container */}
      <div className="relative w-48 h-24 mb-4">
        {/* Background Arc */}
        <svg className="w-full h-full" viewBox="0 0 200 100">
          <path
            d="M 20 90 A 80 80 0 0 1 180 90"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="16"
            strokeLinecap="round"
          />
          {/* Progress Arc */}
          <path
            d="M 20 90 A 80 80 0 0 1 180 90"
            fill="none"
            stroke="url(#gradient)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${(percentage / 100) * 251.2} 251.2`}
          />
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" className={`stop-color-${color}-400`} stopColor={color === 'teal' ? '#2dd4bf' : color === 'emerald' ? '#34d399' : color === 'cyan' ? '#22d3ee' : color === 'orange' ? '#fb923c' : '#f87171'} />
              <stop offset="100%" className={`stop-color-${color}-600`} stopColor={color === 'teal' ? '#0d9488' : color === 'emerald' ? '#059669' : color === 'cyan' ? '#0891b2' : color === 'orange' ? '#ea580c' : '#dc2626'} />
            </linearGradient>
          </defs>
        </svg>

        {/* Center Value */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
          <div className={`text-3xl font-bold ${colorClasses.text}`}>
            {value}
          </div>
          {trend && (
            <div
              className={`text-xs font-medium mt-1 ${
                trend.isPositive ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {trend.isPositive ? '↑' : '↓'} {trend.value}
            </div>
          )}
        </div>
      </div>

      {/* Labels */}
      <div className="text-center">
        <p className="text-sm font-medium text-gray-900 mb-1">{title}</p>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}
