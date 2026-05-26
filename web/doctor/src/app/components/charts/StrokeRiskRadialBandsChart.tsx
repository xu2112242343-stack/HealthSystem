import React from 'react';
import {
  Legend,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

export type StrokeByDmRow = { group: string; stroke_risk: number };

/**
 * 同心径向带图（radial bar）：两组各占一环，长度映射高风险占比；与柱图数据一致，形态为「风险压力环」。
 */
export function StrokeRiskRadialBandsChart({ data }: { data: StrokeByDmRow[] }) {
  const chartData = data.map((r) => ({
    name: r.group,
    value: Number((r.stroke_risk * 100).toFixed(1)),
    fill: r.group.includes('糖尿病') && !r.group.includes('非') ? '#4f46e5' : '#94a3b8',
  }));

  return (
    <div className="w-full">
      <p className="mb-2 text-center text-sm text-slate-500 sm:text-xs">
        径向带长度 = 该组中脑卒中高风险占比（%）；内环 / 外环对应两个分组，灰底为 0–100% 轨道。
      </p>
      <div className="h-[300px] w-full sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="48%"
            innerRadius="18%"
            outerRadius="92%"
            barSize={22}
            data={chartData}
            startAngle={200}
            endAngle={-20}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              background={{ fill: '#f1f5f9' }}
              dataKey="value"
              cornerRadius={10}
              className="drop-shadow-sm"
            />
            <Tooltip
              formatter={(v: number) => [`${v}%`, '高风险占比']}
              labelFormatter={(name) => String(name)}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid rgb(226 232 240)',
                boxShadow: '0 10px 40px -12px rgb(15 23 42 / 0.15)',
              }}
            />
            <Legend
              layout="horizontal"
              verticalAlign="bottom"
              align="center"
              wrapperStyle={{ paddingTop: 12, fontSize: 12 }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
