import React from 'react';

// 其它（系统设置）模块图表 — 第三方服务概览
export function SystemSettingsChart() {
  const apiData: { name: string; 调用次数: number; 成功率: number }[] = [];

  return (
    <div className="max-w-4xl mx-auto w-full">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 sm:p-8">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900">第三方服务状态</h3>
          <p className="text-sm text-gray-600 mt-1">API 调用量与成功率</p>
        </div>
        {apiData.length === 0 ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 text-center text-sm text-gray-500">
            暂无第三方服务监控数据，接入网关或日志统计后展示。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {apiData.map((service, index) => (
              <div
                key={index}
                className="rounded-xl border border-gray-100 bg-gray-50/50 p-5 hover:border-teal-100 hover:bg-teal-50/20 transition-colors"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold text-gray-900">{service.name}</span>
                  <span className="text-sm text-emerald-600 font-semibold tabular-nums">{service.成功率}%</span>
                </div>
                <div className="text-xs text-gray-500 mb-3">调用次数 {service.调用次数.toLocaleString()}</div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 h-2 rounded-full transition-all"
                    style={{ width: `${service.成功率}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
