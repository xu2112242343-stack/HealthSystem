import React, { useId, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type FactorRow = { name: string; value: number };

const TEAL = '#0d9488';
const TEAL_SOFT = '#5eead4';
const TEAL_MUTED = '#99f6e4';

/**
 * 雷达 + 横向条形联动：悬停任一侧高亮同一因子（轴标签、顶点、条形同步）。
 */
export function FactorContributionRadarChart({ factors }: { factors: FactorRow[] }) {
  const gid = useId().replace(/:/g, '');
  const [highlight, setHighlight] = useState<string | null>(null);

  const radarData = useMemo(
    () => factors.map((f) => ({ metric: f.name, w: f.value })),
    [factors],
  );

  const barData = useMemo(() => {
    return [...factors]
      .map((f) => ({ metric: f.name, w: f.value }))
      .sort((a, b) => b.w - a.w);
  }, [factors]);

  const radiusMax = useMemo(() => {
    const m = Math.max(0.08, ...factors.map((f) => f.value));
    return Math.min(0.95, Math.ceil((m * 1.2) / 0.05) * 0.05);
  }, [factors]);

  return (
    <div
      className="w-full"
      onMouseLeave={() => setHighlight(null)}
    >
      <p className="mb-3 text-center text-sm text-slate-500 sm:text-xs">
        左侧为多维轮廓，右侧为按权重排序的条形；悬停雷达顶点、轴名或条形可联动高亮。
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6 lg:items-stretch">
        <div className="min-h-[260px] h-[280px] sm:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="52%" outerRadius="74%" data={radarData}>
              <defs>
                <linearGradient id={`${gid}-rad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#0f766a" stopOpacity={0.22} />
                </linearGradient>
              </defs>
              <PolarGrid stroke="#e2e8f0" strokeDasharray="4 6" />
              <PolarAngleAxis
                dataKey="metric"
                tick={(tp) => {
                  const { x, y, payload, textAnchor } = tp;
                  const name = String(payload.value);
                  const isHi = highlight === name;
                  const isDim = highlight != null && !isHi;
                  return (
                    <text
                      x={x}
                      y={y}
                      textAnchor={textAnchor as 'start' | 'middle' | 'end'}
                      dy={4}
                      fontSize={isHi ? 12 : 11}
                      fontWeight={isHi ? 700 : 500}
                      fill={isDim ? '#cbd5e1' : isHi ? '#0f766a' : '#475569'}
                      className="cursor-default"
                      onMouseEnter={() => setHighlight(name)}
                    >
                      {name}
                    </text>
                  );
                }}
              />
              <PolarRadiusAxis
                angle={36}
                domain={[0, radiusMax]}
                tickCount={4}
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
              />
              <Radar
                name="贡献份额"
                dataKey="w"
                stroke={TEAL}
                strokeWidth={2}
                fill={`url(#${gid}-rad)`}
                fillOpacity={highlight ? 0.45 : 1}
                dot={(props: {
                  cx?: number;
                  cy?: number;
                  payload?: { metric: string };
                }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || !payload?.metric) return null;
                  const isHi = highlight === payload.metric;
                  const isDim = highlight != null && !isHi;
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isHi ? 7 : isDim ? 3 : 4}
                      fill={isDim ? '#94a3b8' : '#0f766a'}
                      stroke="#fff"
                      strokeWidth={2}
                      className="cursor-default"
                      onMouseEnter={() => setHighlight(payload.metric)}
                    />
                  );
                }}
              />
              <Tooltip
                formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, '权重']}
                labelFormatter={(l) => String(l)}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid rgb(226 232 240)',
                  boxShadow: '0 10px 40px -12px rgb(15 23 42 / 0.15)',
                }}
                cursor={false}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="min-h-[260px] h-[280px] sm:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={barData}
              margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
              barCategoryGap={10}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, radiusMax]}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
              />
              <YAxis
                type="category"
                dataKey="metric"
                width={72}
                tick={{ fontSize: 11, fill: '#475569' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, '权重']}
                labelFormatter={(l) => String(l)}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid rgb(226 232 240)',
                  boxShadow: '0 10px 40px -12px rgb(15 23 42 / 0.15)',
                }}
                cursor={{ fill: 'rgb(240 253 250 / 0.6)' }}
              />
              <Bar
                dataKey="w"
                radius={[0, 6, 6, 0]}
                maxBarSize={22}
                onMouseEnter={(row: { metric?: string }) => {
                  if (row?.metric) setHighlight(row.metric);
                }}
              >
                {barData.map((row) => {
                  const isHi = highlight === row.metric;
                  const isDim = highlight != null && !isHi;
                  return (
                    <Cell
                      key={row.metric}
                      fill={isHi ? TEAL : isDim ? TEAL_MUTED : TEAL_SOFT}
                      stroke={isHi ? '#0f766a' : 'transparent'}
                      strokeWidth={isHi ? 1.5 : 0}
                      style={{ transition: 'fill 0.15s ease' }}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
