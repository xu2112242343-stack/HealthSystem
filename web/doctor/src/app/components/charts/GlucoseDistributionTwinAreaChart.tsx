import React, { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type GlucoseHistRow = {
  range: string;
  糖尿病组: number;
  非糖尿病组: number;
};

/**
 * 双序列面积 + 曲线：同一血糖区间上的两组人数轮廓，强调分布形态差异（与分组柱图数据一致）。
 */
export function GlucoseDistributionTwinAreaChart({ data }: { data: GlucoseHistRow[] }) {
  const gid = useId().replace(/:/g, '');

  return (
    <div className="w-full">
      <p className="mb-2 text-center text-sm text-slate-500 sm:text-xs">
        平滑曲线连接各区间计数；半透明面积层叠展示两组分布轮廓，纵轴仍为人数（非密度估计）。
      </p>
      <div className="h-[300px] w-full sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id={`${gid}-dm`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id={`${gid}-nd`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#64748b" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#64748b" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 6" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="range"
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
              label={{ value: '空腹血糖区间 (mmol/L)', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#64748b' }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              width={36}
              label={{ value: '人数', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: '1px solid rgb(226 232 240)',
                boxShadow: '0 10px 40px -12px rgb(15 23 42 / 0.15)',
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: 8, fontSize: 12 }}
              iconType="circle"
            />
            <Area
              type="monotone"
              dataKey="糖尿病组"
              name="糖尿病组"
              stroke="#2563eb"
              strokeWidth={2}
              fill={`url(#${gid}-dm)`}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
            />
            <Area
              type="monotone"
              dataKey="非糖尿病组"
              name="非糖尿病组"
              stroke="#475569"
              strokeWidth={2}
              fill={`url(#${gid}-nd)`}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
