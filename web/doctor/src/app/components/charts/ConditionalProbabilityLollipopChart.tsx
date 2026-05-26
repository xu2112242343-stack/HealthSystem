import React from 'react';

export type ConditionalProbRow = { group: string; prob: number };

/**
 * 双轨棒棒糖图（lollipop / dot-and-whisker 风格）：适合 2 点条件概率对比，强调「绝对水平 + 间距」。
 */
export function ConditionalProbabilityLollipopChart({ data }: { data: ConditionalProbRow[] }) {
  const maxP = Math.max(0.12, 0.5, ...data.map((d) => d.prob));
  const scale = (p: number) => `${(p / maxP) * 100}%`;
  const deltaPp =
    data.length === 2 ? Math.abs(data[0]!.prob - data[1]!.prob) * 100 : null;

  return (
    <div className="w-full space-y-8 px-1 sm:px-4">
      <p className="text-center text-sm text-slate-500 sm:text-xs">
        双轨棒棒糖图：同一横轴比例尺下对比 P(糖尿病|分组)；圆点即估计概率，色带为 0→该点的示意轨长。
      </p>
      {data.map((row) => {
        const pct = row.prob * 100;
        return (
          <div key={row.group}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{row.group}</span>
              <span className="tabular-nums text-sm font-bold text-teal-800">{pct.toFixed(1)}%</span>
            </div>
            <div className="relative h-3 rounded-full bg-slate-100 ring-1 ring-slate-200/80">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-teal-200/90 via-teal-500 to-teal-700 shadow-inner"
                style={{ width: scale(row.prob) }}
              />
              <div
                className="absolute top-1/2 z-[1] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-teal-600 shadow-md ring-2 ring-teal-500/30"
                style={{ left: scale(row.prob) }}
              />
            </div>
          </div>
        );
      })}
      {deltaPp != null ? (
        <p className="rounded-xl bg-indigo-50/80 px-3 py-2.5 text-center text-xs leading-relaxed text-indigo-950 ring-1 ring-indigo-100">
          两组概率绝对差约{' '}
          <span className="font-bold tabular-nums">{deltaPp.toFixed(1)}</span> 个百分点（percentage points）
        </p>
      ) : null}
      <div className="flex justify-between border-t border-slate-100 pt-3 text-xs font-medium text-slate-400">
        <span>0%</span>
        <span>横轴参照上限 {(maxP * 100).toFixed(0)}%（非概率上界，仅便于同屏对比）</span>
      </div>
    </div>
  );
}
