import React, { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

import { fetchAdminDatabaseStats } from '@/lib/api/adminDatabaseStats';

// 医疗数据库管理模块图表
export function DatabaseChart() {
  const [loading, setLoading] = useState(false);
  const [diseaseData, setDiseaseData] = useState<{ name: string; value: number }[]>([]);
  const hospitalData = useMemo(
    () =>
      [
        { name: '甲等', value: 8 },
        { name: '综合', value: 2 },
      ] as { name: string; value: number }[],
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetchAdminDatabaseStats(30);
        if (cancelled) return;
        setDiseaseData(
          (res.healthArticlesByDisease || []).map((x) => ({
            name: String(x.name || ''),
            value: Number.isFinite(x.value) ? x.value : 0,
          })),
        );
      } catch {
        if (cancelled) return;
        setDiseaseData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const COLORS = ['#14b8a6', '#06b6d4', '#8b5cf6'];
  const HOSPITAL_COLORS = ['#10b981', '#06b6d4', '#f59e0b', '#6366f1'];

  const emptyBlock = (hint: string) => (
    <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 text-center text-sm text-gray-500">
      {hint}
    </div>
  );

  const emptyText = useMemo(
    () => (loading ? '统计数据加载中...' : '暂无统计数据。'),
    [loading],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">健康内容分布</h3>
          <p className="text-sm text-gray-600 mt-1">按疾病分类标签统计</p>
        </div>
        {diseaseData.length === 0 ? (
          emptyBlock(emptyText)
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={diseaseData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {diseaseData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">三级医院分布</h3>
          <p className="text-sm text-gray-600 mt-1">固定展示：甲等 8、综合 2</p>
        </div>
        {hospitalData.length === 0 ? (
          emptyBlock(emptyText)
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={hospitalData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {hospitalData.map((entry, index) => (
                  <Cell key={`cell-h-${index}`} fill={HOSPITAL_COLORS[index % HOSPITAL_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
