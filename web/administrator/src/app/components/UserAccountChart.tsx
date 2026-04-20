import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

import { fetchAdminDashboardOverview } from '@/lib/api/adminDashboard';

// 用户账户管理模块图表
export function UserAccountChart() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ day: string; 新增用户: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetchAdminDashboardOverview(30);
        if (cancelled) return;
        const list = Array.isArray(res.registrationTrend) ? res.registrationTrend : [];
        setData(
          list.map((it) => ({
            day: String(it.date || '').slice(5),
            新增用户: Number.isFinite(it.user) ? it.user : 0,
          })),
        );
      } catch {
        if (cancelled) return;
        setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const emptyText = useMemo(() => (loading ? '统计数据加载中...' : '暂无统计数据。'), [loading]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">用户增长趋势</h3>
        <p className="text-sm text-gray-600 mt-1">近 30 天新增注册数量统计</p>
      </div>
      {data.length === 0 ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 text-center text-sm text-gray-500">
          {emptyText}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="新增用户" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
