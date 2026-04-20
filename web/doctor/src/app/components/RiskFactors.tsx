import React from 'react';

const riskFactors = [
  { name: '高血压', value: 85, color: '#ef4444' },
  { name: '吸烟史', value: 72, color: '#f97316' },
  { name: 'BMI超标', value: 68, color: '#eab308' },
  { name: '高血脂', value: 61, color: '#06b6d4' },
  { name: '久坐', value: 55, color: '#8b5cf6' },
  { name: '饮酒', value: 48, color: '#ec4899' },
];

export function RiskFactors() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 h-full flex flex-col">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">主要影响因素</h3>
        <p className="text-sm text-gray-500 mt-1">Top 6 风险因素统计</p>
      </div>

      <div className="space-y-4 flex-1 flex flex-col justify-center">
        {riskFactors.map((factor, index) => (
          <div key={index}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">{factor.name}</span>
              <div className="flex items-center gap-2">
                <div 
                  className="w-16 h-6 rounded flex items-center justify-center"
                  style={{ backgroundColor: factor.color }}
                >
                  <span className="text-xs font-medium text-white">{factor.value}</span>
                </div>
              </div>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${factor.value}%`, backgroundColor: factor.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}