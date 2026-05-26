import React, { useId } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

export type RiskStructureRow = {
  disease: string;
  low: number;
  mid: number;
  high: number;
};

type PieSlice = { name: string; value: number; gradId: string };

const TOOLTIP_SHEET = {
  borderRadius: 12,
  border: '1px solid rgb(226 232 240)',
  boxShadow: '0 10px 40px -12px rgb(15 23 42 / 0.18)',
  padding: '10px 14px',
  background: 'rgb(255 255 255 / 0.97)',
};

function buildSlices(row: RiskStructureRow, gradBase: string): PieSlice[] {
  const out: PieSlice[] = [];
  if (row.low > 0) out.push({ name: '低风险', value: row.low, gradId: `${gradBase}-low` });
  if (row.mid > 0) out.push({ name: '中风险', value: row.mid, gradId: `${gradBase}-mid` });
  if (row.high > 0) out.push({ name: '高风险', value: row.high, gradId: `${gradBase}-high` });
  return out;
}

/**
 * 构成型环形图（Compositional donut trio）
 * 同一队列下各病种风险分层人数构成；与堆叠柱信息等价，强调「占比构成」而非柱高比较。
 */
export function DiseaseInternalRiskStructureChart({ data }: { data: RiskStructureRow[] }) {
  const uid = useId().replace(/:/g, '');

  return (
    <div className="w-full">
      <p className="mb-5 text-center text-sm leading-relaxed text-slate-500 sm:text-xs">
        三枚环形成分图并列：环上角度 ∝ 人数；中心为该病种分层合计（与队列样本量一致）。
        <span className="hidden sm:inline"> 悬停扇区查看人数与占比。</span>
      </p>

      <div className="mb-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-b border-slate-100 pb-4 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-teal-300 to-teal-700 shadow-sm ring-1 ring-white" />
          低风险
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-amber-300 to-amber-700 shadow-sm ring-1 ring-white" />
          中风险
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-rose-300 to-rose-700 shadow-sm ring-1 ring-white" />
          高风险
        </span>
      </div>

      <div className="grid grid-cols-1 gap-12 sm:grid-cols-3 sm:gap-6 lg:gap-10">
        {data.map((row, idx) => {
          const gradBase = `${uid}-d${idx}`;
          const slices = buildSlices(row, gradBase);
          const total = row.low + row.mid + row.high;
          const pct = (n: number) => (total > 0 ? (100 * n) / total : 0);

          return (
            <div
              key={row.disease}
              className="relative mx-auto flex w-full max-w-[240px] flex-col items-center"
            >
              <div className="relative h-[220px] w-full sm:h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                    <defs>
                      <linearGradient id={`${gradBase}-low`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#5eead4" />
                        <stop offset="100%" stopColor="#0f766a" />
                      </linearGradient>
                      <linearGradient id={`${gradBase}-mid`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#fcd34d" />
                        <stop offset="100%" stopColor="#b45309" />
                      </linearGradient>
                      <linearGradient id={`${gradBase}-high`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#fda4af" />
                        <stop offset="100%" stopColor="#9f1239" />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      wrapperStyle={{ zIndex: 40 }}
                      contentStyle={TOOLTIP_SHEET}
                      formatter={(value: number, name: string) => {
                        const v = Number(value);
                        const p = total > 0 ? ((100 * v) / total).toFixed(1) : '0.0';
                        return [`${v} 人（${p}%）`, name];
                      }}
                      labelFormatter={() => row.disease}
                    />
                    <Pie
                      data={slices}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius="56%"
                      outerRadius="88%"
                      paddingAngle={2.8}
                      cornerRadius={6}
                      stroke="#ffffff"
                      strokeWidth={2}
                      isAnimationActive
                      animationDuration={480}
                    >
                      {slices.map((s) => (
                        <Cell key={s.gradId} fill={`url(#${s.gradId})`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>

                <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-[min(46%,7.5rem)] -translate-x-1/2 -translate-y-1/2 text-center">
                  <p className="text-sm font-semibold tracking-tight text-slate-700">{row.disease}</p>
                </div>
              </div>

              <div className="mt-3 flex w-full flex-wrap justify-center gap-x-2 gap-y-1.5 text-xs">
                <span className="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-900 ring-1 ring-teal-100/80">
                  低 {pct(row.low).toFixed(1)}%
                </span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-950 ring-1 ring-amber-100/80">
                  中 {pct(row.mid).toFixed(1)}%
                </span>
                <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-950 ring-1 ring-rose-100/80">
                  高 {pct(row.high).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
