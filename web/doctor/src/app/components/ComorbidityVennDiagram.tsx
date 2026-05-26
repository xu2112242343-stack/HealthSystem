import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PLATFORM_DEMO_COMORBIDITY, PLATFORM_DEMO_PATIENT_COHORT } from '@shared/demo/platformDemo';

/** 1=代谢相关脂肪性肝病，2=2型糖尿病，3=脑卒中 */
export type VennRegionKey = '1' | '2' | '3' | '12' | '13' | '23' | '123';

/** 默认与平台演示队列一致（七种区划之和 = 总患者数） */
export const COMORBIDITY_VENN_SAMPLE_TOTAL = PLATFORM_DEMO_PATIENT_COHORT;

const DEFAULT_COUNTS: Record<VennRegionKey, number> = { ...PLATFORM_DEMO_COMORBIDITY };

const REGION_META: Record<VennRegionKey, { name: string }> = {
  '1': { name: '仅代谢相关脂肪性肝病' },
  '2': { name: '仅 2 型糖尿病' },
  '3': { name: '仅脑卒中' },
  '12': { name: '代谢相关脂肪性肝病 + 2 型糖尿病' },
  '13': { name: '代谢相关脂肪性肝病 + 脑卒中' },
  '23': { name: '2 型糖尿病 + 脑卒中' },
  '123': { name: '三者并存' },
};

/** 热区：圆心、半径；绘制顺序从前到后，后者优先捕获（123 最后） */
const HIT_ZONES: { key: VennRegionKey; cx: number; cy: number; r: number }[] = [
  { key: '1', cx: 128, cy: 168, r: 42 },
  { key: '2', cx: 378, cy: 168, r: 42 },
  { key: '3', cx: 248, cy: 298, r: 40 },
  { key: '12', cx: 248, cy: 150, r: 30 },
  { key: '13', cx: 198, cy: 218, r: 28 },
  { key: '23', cx: 302, cy: 218, r: 28 },
  { key: '123', cx: 248, cy: 208, r: 22 },
];

export interface ComorbidityVennProps {
  /** 覆盖默认的七种划分人数；未填项沿用内置示例 */
  regions?: Partial<Record<VennRegionKey, number>>;
}

const font = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export function ComorbidityVennDiagram({ regions: regionsProp }: ComorbidityVennProps) {
  const counts = useMemo(() => ({ ...DEFAULT_COUNTS, ...regionsProp }), [regionsProp]);
  const total = useMemo(
    () => (Object.keys(counts) as VennRegionKey[]).reduce((s, k) => s + counts[k], 0),
    [counts],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ key: VennRegionKey; x: number; y: number } | null>(null);

  const moveTip = useCallback((e: React.MouseEvent, key: VennRegionKey) => {
    const root = wrapRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    setTip({ key, x: e.clientX - r.left, y: e.clientY - r.top });
  }, []);

  const clearTip = useCallback(() => setTip(null), []);

  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  const tipBody = tip ? REGION_META[tip.key] : null;
  const tipCount = tip ? counts[tip.key] : 0;

  const ariaSummary = (Object.keys(REGION_META) as VennRegionKey[])
    .map((k) => `${REGION_META[k].name}：${counts[k]} 人`)
    .join('；');

  return (
    <figure className="w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-white to-teal-50/30 p-5 sm:p-6 shadow-sm">
      <div ref={wrapRef} className="relative">
        <p className="mb-2 text-center text-sm text-slate-500 leading-relaxed px-1">
          三圆对应代谢相关脂肪性肝病、2 型糖尿病与脑卒中；七种互斥区划合计{' '}
          <span className="font-medium tabular-nums text-slate-600">{total.toLocaleString()}</span> 人，与上方总患者数一致；悬停各重叠区域查看人数与占比。
        </p>

        <svg
          viewBox="0 0 520 378"
          className="mx-auto w-full max-w-xl h-auto drop-shadow-sm"
          role="img"
          aria-label={`共病韦恩图七种交集划分，共 ${total} 人：${ariaSummary}。悬停各热区查看详情。`}
        >
          <defs>
            <radialGradient id="venn-liver" cx="32%" cy="32%" r="78%">
              <stop offset="0%" stopColor="#fcd34d" stopOpacity="0.55" />
              <stop offset="55%" stopColor="#f59e0b" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#d97706" stopOpacity="0.12" />
            </radialGradient>
            <radialGradient id="venn-dm" cx="38%" cy="28%" r="78%">
              <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.55" />
              <stop offset="55%" stopColor="#3b82f6" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.1" />
            </radialGradient>
            <radialGradient id="venn-stroke" cx="50%" cy="22%" r="80%">
              <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.5" />
              <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#5b21b6" stopOpacity="0.1" />
            </radialGradient>
            <filter id="venn-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#0f172a" floodOpacity="0.07" />
            </filter>
          </defs>

          <ellipse cx={260} cy={200} rx={210} ry={150} fill="#f8fafc" opacity={0.9} />

          <g filter="url(#venn-glow)" style={{ pointerEvents: 'none' }}>
            <circle cx={248} cy={258} r={94} fill="url(#venn-stroke)" stroke="#7c3aed" strokeOpacity={0.35} strokeWidth={1.25} />
            <circle cx={178} cy={178} r={94} fill="url(#venn-liver)" stroke="#b45309" strokeOpacity={0.32} strokeWidth={1.25} />
            <circle cx={318} cy={178} r={94} fill="url(#venn-dm)" stroke="#1d4ed8" strokeOpacity={0.32} strokeWidth={1.25} />
          </g>

          <g style={{ fontFamily: font, pointerEvents: 'none' }}>
            <text x={78} y={58} textAnchor="middle" fill="#92400e" fontSize={11} fontWeight={700} letterSpacing="0.02em">
              代谢相关脂肪性肝病
            </text>
            <text x={78} y={74} textAnchor="middle" fill="#b45309" fontSize={9} fontWeight={500} opacity={0.85}>
              MAFLD
            </text>
            <text x={442} y={58} textAnchor="middle" fill="#1e40af" fontSize={12} fontWeight={700} letterSpacing="0.02em">
              2 型糖尿病
            </text>
            <text x={442} y={74} textAnchor="middle" fill="#3b82f6" fontSize={9} fontWeight={500} opacity={0.85}>
              T2DM
            </text>
            <text x={260} y={348} textAnchor="middle" fill="#5b21b6" fontSize={12} fontWeight={700} letterSpacing="0.02em">
              脑卒中
            </text>
            <text x={260} y={362} textAnchor="middle" fill="#7c3aed" fontSize={9} fontWeight={500} opacity={0.85}>
              CVA
            </text>
          </g>

          <g style={{ cursor: 'pointer' }}>
            {HIT_ZONES.map(({ key, cx, cy, r }) => (
              <circle
                key={key}
                cx={cx}
                cy={cy}
                r={r}
                fill="transparent"
                stroke="none"
                onMouseEnter={(e) => moveTip(e, key)}
                onMouseMove={(e) => moveTip(e, key)}
                onMouseLeave={clearTip}
              />
            ))}
          </g>
        </svg>

        {tip && tipBody && (
          <div
            className="pointer-events-none absolute z-20 min-w-[140px] max-w-[260px] rounded-lg border border-slate-700/20 bg-slate-900 px-3 py-2.5 text-left text-white shadow-xl shadow-slate-900/25"
            style={{
              left: Math.min(tip.x + 14, (wrapRef.current?.clientWidth ?? 0) - 220),
              top: Math.min(tip.y + 12, (wrapRef.current?.clientHeight ?? 0) - 120),
            }}
            role="tooltip"
          >
            <p className="text-sm font-semibold leading-snug text-white">{tipBody.name}</p>
            <p className="mt-2 text-sm font-bold tabular-nums text-white" style={{ fontFamily: font }}>
              {tipCount.toLocaleString()} 人
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-slate-300" style={{ fontFamily: font }}>
              占全集 {pct(tipCount)}%
            </p>
          </div>
        )}
      </div>

      <figcaption className="mt-4 text-center text-sm leading-relaxed text-slate-500 px-1 border-t border-slate-200/60 pt-4">
        三色圆为<span className="font-medium text-slate-600">结构示意</span>
        ；上述七类人数之和为{' '}
        <span className="tabular-nums font-medium text-slate-600">{total.toLocaleString()}</span> 人（与总体统计总患者数一致），
        <span className="font-medium text-slate-600">不按面积精确比例</span>。热区为近似中心点，便于交互。
      </figcaption>
    </figure>
  );
}
