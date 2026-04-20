import React from 'react';

export function RiskAnalysisChart() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">群体风险分析 & 患者画像</h3>
        <p className="text-sm text-gray-500 mt-1">基于队列数据的多维风险评估（待接入数据源）</p>
      </div>
      <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 text-center text-sm text-gray-500">
        暂无群体风险与画像数据，接入分析接口或报表后将在此展示雷达图与趋势。
      </div>
    </div>
  );
}
