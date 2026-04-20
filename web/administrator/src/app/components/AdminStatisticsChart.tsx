import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AdminStatisticsChartProps {
  data: { name: string; 用户注册: number; 医生注册: number }[];
  loading?: boolean;
}

export function AdminStatisticsChart({ data, loading = false }: AdminStatisticsChartProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 h-full flex flex-col">
      <div className="mb-4 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900">本周系统数据统计</h3>
        <p className="text-sm text-gray-500 mt-1">用户与医生注册趋势</p>
      </div>
      <div className="w-full flex-1 min-h-[300px]">
        {data.length === 0 ? (
          <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 text-center text-sm text-gray-500">
            {loading ? '统计数据加载中...' : '暂无统计数据。'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" stroke="#666" fontSize={12} />
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
              <Bar dataKey="用户注册" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="医生注册" fill="#0891b2" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
