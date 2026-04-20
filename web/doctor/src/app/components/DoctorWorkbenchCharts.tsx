import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ComorbidityVennDiagram } from '@/app/components/ComorbidityVennDiagram';
import type { DiseaseAnalysisDashboard } from '@/lib/api/diseaseAnalysisDashboard';

const PIE_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6'];

const tooltipStyle = {
  contentStyle: {
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    fontSize: '12px',
  },
};

export type DoctorWorkbenchChartsProps = {
  riskBar: Array<{ level: string; count: number; fill: string }>;
  pieData: Array<{ name: string; value: number }>;
  comorbidityRegions: DiseaseAnalysisDashboard['comorbidityRegions'];
  topFactors: Array<{ name: string; value: number; color: string }>;
};

/**
 * Recharts + 韦恩图体积较大，懒加载以缩小医生端首包、数据返回后先出统计区再出图。
 */
export default function DoctorWorkbenchCharts({
  riskBar,
  pieData,
  comorbidityRegions,
  topFactors,
}: DoctorWorkbenchChartsProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="flex min-h-[320px] flex-col rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-1 text-base font-semibold text-gray-900">风险分布</h2>
          <div className="min-h-[240px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskBar} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="level" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} 人`, '人数']} />
                <Bar dataKey="count" name="人数" radius={[6, 6, 0, 0]}>
                  {riskBar.map((e) => (
                    <Cell key={e.level} fill={e.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="flex min-h-[320px] flex-col rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-1 text-base font-semibold text-gray-900">三病占比</h2>
          <div className="flex min-h-[240px] flex-1 items-center">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={88}
                  paddingAngle={2}
                >
                  {pieData.map((e, i) => (
                    <Cell key={e.name} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#fff" strokeWidth={1} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} 人`, '']} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-base font-semibold text-gray-900">共病分布</h2>
        <ComorbidityVennDiagram regions={comorbidityRegions} />
      </section>

      <RiskFactorsPanel factors={topFactors} />
    </>
  );
}

function RiskFactorsPanel({ factors }: { factors: Array<{ name: string; value: number; color: string }> }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="mb-6 max-w-3xl">
        <h2 className="text-base font-semibold text-gray-900">主要患病因素</h2>
      </div>

      {factors.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center text-sm text-gray-400">暂无数据</div>
      ) : (
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 lg:grid-cols-2">
          {factors.map((factor, index) => (
            <div
              key={factor.name}
              className="group rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50/80 to-white px-4 py-3.5 transition-shadow hover:border-gray-200/80 hover:shadow-sm"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums text-white shadow-sm"
                    style={{ backgroundColor: factor.color }}
                  >
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium leading-snug text-gray-800">{factor.name}</span>
                </div>
                <span
                  className="shrink-0 rounded-md bg-white/90 px-2 py-0.5 text-xs font-bold tabular-nums ring-1 ring-gray-200/80"
                  style={{ color: factor.color }}
                >
                  {factor.value}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200/60">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out group-hover:opacity-95"
                  style={{
                    width: `${factor.value}%`,
                    backgroundColor: factor.color,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
