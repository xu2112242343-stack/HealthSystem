import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface SystemActivityChartProps {
  data: { time: string; 活跃用户: number; 活跃医生: number }[];
  loading?: boolean;
}

export function SystemActivityChart({ data, loading = false }: SystemActivityChartProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 h-full flex flex-col">
      <div className="mb-4 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900">今日系统活跃度</h3>
        <p className="text-sm text-gray-500 mt-1">实时监控用户和医生在线活跃情况</p>
      </div>
      <div className="w-full flex-1 min-h-[300px]">
        {data.length === 0 ? (
          <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 text-center text-sm text-gray-500">
            {loading ? '活跃度数据加载中...' : '暂无活跃度数据，登录后将自动累计。'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" stroke="#666" fontSize={12} />
              <YAxis stroke="#666" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="活跃用户"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: '#10b981', r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="活跃医生"
                stroke="#0891b2"
                strokeWidth={2}
                dot={{ fill: '#0891b2', r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
