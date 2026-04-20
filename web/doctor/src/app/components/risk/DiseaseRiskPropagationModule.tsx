import React, { useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/app/components/ui/utils';

export type PropagationDiseaseId = 'liver' | 'diabetes' | 'stroke';

type RiskLevel = 'low' | 'medium' | 'high';

export interface PropagationDiseaseModel {
  id: PropagationDiseaseId;
  shortName: string;
  fullName: string;
  risk: RiskLevel;
  riskLabel: string;
  score: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'emerald' | 'red' | 'amber';
}

function riskPill(risk: RiskLevel) {
  switch (risk) {
    case 'high':
      return 'bg-rose-100 text-rose-900 ring-1 ring-rose-200';
    case 'medium':
      return 'bg-amber-50 text-amber-950 ring-1 ring-amber-200';
    default:
      return 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200';
  }
}

function accentIconWrap(accent: PropagationDiseaseModel['accent']) {
  switch (accent) {
    case 'red':
      return 'from-rose-500 to-red-600 shadow-red-500/25';
    case 'amber':
      return 'from-amber-500 to-orange-600 shadow-amber-500/25';
    default:
      return 'from-emerald-500 to-teal-600 shadow-emerald-500/25';
  }
}

/** Sankey 流带：最细 / 最宽（viewBox 单位，随 impact 插值） */
const FLOW_W_MIN = 5;
const FLOW_W_MAX = 22;
const FLOW_GLOW_PAD = 10;

/** viewBox 尺寸（与外层 aspect、节点百分比一致） */
const PROP_VB = { w: 420, h: 312 } as const;

/** 三角图节点中心：拉宽、拉高，给边线与标签留出空隙 */
const PROP_NODE = {
  liver: { x: 112, y: 64 },
  diabetes: { x: 308, y: 64 },
  stroke: { x: 210, y: 244 },
} as const;

/**
 * 沿 A→B 缩短线段，避免箭头尖端落在白底卡片下方。
 * padStart / padEnd 为从两端中心沿连线向内的距离（含目标端为 marker 预留的空隙）。
 */
function shortenBetween(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  padStart: number,
  padEnd: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x1: ax, y1: ay, x2: bx, y2: by };
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: ax + ux * padStart,
    y1: ay + uy * padStart,
    x2: bx - ux * padEnd,
    y2: by - uy * padEnd,
  };
}

function flowWidth(impact: number) {
  const t = Math.max(0, Math.min(1, (impact - 3) / (98 - 3)));
  return FLOW_W_MIN + t * (FLOW_W_MAX - FLOW_W_MIN);
}

type Cubic = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
};

function cubicPoint(c: Cubic, t: number) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * c.x0 + 3 * uu * t * c.x1 + 3 * u * tt * c.x2 + ttt * c.x3,
    y: uuu * c.y0 + 3 * uu * t * c.y1 + 3 * u * tt * c.y2 + ttt * c.y3,
  };
}

/** 三次贝塞尔一阶导 B′(t) */
function cubicDerivative(c: Cubic, t: number) {
  const u = 1 - t;
  const p0 = { x: c.x0, y: c.y0 };
  const p1 = { x: c.x1, y: c.y1 };
  const p2 = { x: c.x2, y: c.y2 };
  const p3 = { x: c.x3, y: c.y3 };
  const dx =
    3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const dy =
    3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len, deg: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * 在 Bézier 上取一点，使其与终点 B(1) 的弦长 ≈ pullChord（二分 t）。
 * 粗流带是沿该曲线 stroke 出来的，几何中心线即曲线本身；若用「从终点沿切线直线后退」会离开曲线，三角会偏到带的一侧。
 */
function arrowAnchorOnCurveCenterline(c: Cubic, pullChord: number) {
  const target = Math.max(8, pullChord);
  let lo = 0.35;
  let hi = 0.9995;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const p = cubicPoint(c, mid);
    const d = Math.hypot(c.x3 - p.x, c.y3 - p.y);
    if (d > target) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const pt = cubicPoint(c, t);
  const tan = cubicDerivative(c, t);
  return { ax: pt.x, ay: pt.y, deg: tan.deg };
}

function bezierControlsForEdge(
  key: string,
  x0: number,
  y0: number,
  x3: number,
  y3: number,
): Cubic {
  if (key === 'liver-diabetes') {
    const dx = x3 - x0;
    return {
      x0,
      y0,
      x1: x0 + dx * 0.28,
      y1: y0 - 38,
      x2: x0 + dx * 0.72,
      y2: y3 - 38,
      x3,
      y3,
    };
  }
  if (key === 'liver-stroke') {
    return {
      x0,
      y0,
      x1: x0 + 72,
      y1: y0 + 92,
      x2: x3 - 58,
      y2: y3 - 92,
      x3,
      y3,
    };
  }
  /* diabetes-stroke */
  return {
    x0,
    y0,
    x1: x0 - 72,
    y1: y0 + 92,
    x2: x3 + 58,
    y2: y3 - 92,
    x3,
    y3,
  };
}

/** 关联强度指数：<30 绿，30–60 黄，>60 红 */
function strengthStyle(impact: number) {
  if (impact < 30) {
    return {
      stroke: '#059669',
      glow: '#34d399',
      labelClass: 'text-emerald-800',
    };
  }
  if (impact <= 60) {
    return {
      stroke: '#b45309',
      glow: '#fbbf24',
      labelClass: 'text-amber-900',
    };
  }
  return {
    stroke: '#be123c',
    glow: '#fb7185',
    labelClass: 'text-rose-800',
  };
}

function edgePropagationIndex(
  sourceScore: number,
  targetScore: number,
  pathWeight: number,
): number {
  const s = sourceScore / 100;
  const t = targetScore / 100;
  const raw = pathWeight * s * (0.45 + 0.55 * t) * 100;
  return Math.max(3, Math.min(98, Math.round(raw)));
}

const EDGES: {
  from: PropagationDiseaseId;
  to: PropagationDiseaseId;
  pathWeight: number;
  clinicalNote: string;
}[] = [
  {
    from: 'liver',
    to: 'diabetes',
    pathWeight: 0.92,
    clinicalNote:
      '胰岛素抵抗与肝脂沉积可相互促进：脂肪肝常伴随糖代谢异常，加重糖尿病发生与进展风险。',
  },
  {
    from: 'liver',
    to: 'stroke',
    pathWeight: 0.58,
    clinicalNote:
      'NAFLD 相关慢性炎症、血脂紊乱与高血压等可共同参与动脉粥样硬化，间接影响脑血管事件风险。',
  },
  {
    from: 'diabetes',
    to: 'stroke',
    pathWeight: 1.05,
    clinicalNote:
      '长期高血糖损伤血管内皮、促进动脉硬化，是缺血性脑卒中的重要可干预危险因素。',
  },
];

function diseaseById(
  list: PropagationDiseaseModel[],
  id: PropagationDiseaseId,
): PropagationDiseaseModel | undefined {
  return list.find((d) => d.id === id);
}

type EdgeRow = {
  key: string;
  from: PropagationDiseaseModel;
  to: PropagationDiseaseModel;
  impact: number;
  label: string;
  clinicalNote: string;
};

export interface DiseaseRiskPropagationModuleProps {
  diseases: PropagationDiseaseModel[];
  selectedId: PropagationDiseaseId;
  onSelectDisease: (id: PropagationDiseaseId) => void;
  className?: string;
  /** 紧凑边距；图示均为三角三边拓扑（与完整页一致） */
  compact?: boolean;
}

export function DiseaseRiskPropagationModule({
  diseases,
  selectedId,
  onSelectDisease,
  className,
  compact,
}: DiseaseRiskPropagationModuleProps) {
  const arrowMarkerId = useId().replace(/:/g, '');
  const chartRef = useRef<HTMLDivElement>(null);
  const [hoverEdgeKey, setHoverEdgeKey] = useState<string | null>(null);
  const [edgeTipPos, setEdgeTipPos] = useState<{ x: number; y: number } | null>(null);

  function updateEdgeTip(ev: React.MouseEvent, edgeKey: string) {
    setHoverEdgeKey(edgeKey);
    const el = chartRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 14;
    let x = ev.clientX - r.left + pad;
    let y = ev.clientY - r.top - pad;
    const tw = Math.min(288, r.width * 0.88);
    const th = 96;
    x = Math.max(8, Math.min(x, r.width - tw - 8));
    y = Math.max(8, Math.min(y, r.height - th - 8));
    setEdgeTipPos({ x, y });
  }

  function clearEdgeTip() {
    setHoverEdgeKey(null);
    setEdgeTipPos(null);
  }

  const liver = diseaseById(diseases, 'liver');
  const dm = diseaseById(diseases, 'diabetes');
  const stroke = diseaseById(diseases, 'stroke');

  const edgeRows = useMemo(() => {
    if (!liver || !dm || !stroke) return [];
    const map = { liver, diabetes: dm, stroke };
    return EDGES.map((e) => {
      const from = map[e.from];
      const to = map[e.to];
      const impact = edgePropagationIndex(from.score, to.score, e.pathWeight);
      const label = `${from.shortName}→${to.shortName}`;
      return {
        key: `${e.from}-${e.to}`,
        from,
        to,
        impact,
        label,
        clinicalNote: e.clinicalNote,
      };
    });
  }, [liver, dm, stroke]);

  const edgeMap = useMemo(() => {
    const m: Record<string, EdgeRow> = {};
    for (const r of edgeRows) m[r.key] = r;
    return m;
  }, [edgeRows]);

  /**
   * 三角边几何：此前对角线 pad 过大（50+78 在约 150 单位边上）会把可见线段缩到 ~20，箭头几乎看不见。
   * 顶边略收即可；指向脑卒中端略多收，保证箭头落在底卡上方空隙。
   */
  const triEdges = useMemo(() => {
    const ld = edgeMap['liver-diabetes'];
    const ds = edgeMap['diabetes-stroke'];
    const ls = edgeMap['liver-stroke'];
    if (!ld || !ds || !ls) return [];
    const PAD_OUT = 46;
    const PAD_TOP_TARGET = 50;
    const PAD_STROKE_TARGET = 70;
    const raw = [
      {
        e: ld,
        ...shortenBetween(
          PROP_NODE.liver.x,
          PROP_NODE.liver.y,
          PROP_NODE.diabetes.x,
          PROP_NODE.diabetes.y,
          PAD_OUT,
          PAD_TOP_TARGET,
        ),
      },
      {
        e: ds,
        ...shortenBetween(
          PROP_NODE.diabetes.x,
          PROP_NODE.diabetes.y,
          PROP_NODE.stroke.x,
          PROP_NODE.stroke.y,
          PAD_OUT,
          PAD_STROKE_TARGET,
        ),
      },
      {
        e: ls,
        ...shortenBetween(
          PROP_NODE.liver.x,
          PROP_NODE.liver.y,
          PROP_NODE.stroke.x,
          PROP_NODE.stroke.y,
          PAD_OUT,
          PAD_STROKE_TARGET,
        ),
      },
    ];
    return raw.map((spec) => {
      const cubic = bezierControlsForEdge(spec.e.key, spec.x1, spec.y1, spec.x2, spec.y2);
      const pathD = `M ${cubic.x0} ${cubic.y0} C ${cubic.x1} ${cubic.y1} ${cubic.x2} ${cubic.y2} ${cubic.x3} ${cubic.y3}`;
      return { ...spec, cubic, pathD };
    });
  }, [edgeMap]);

  const eLiverDm = edgeMap['liver-diabetes'];
  const eDmStroke = edgeMap['diabetes-stroke'];
  const eLiverStroke = edgeMap['liver-stroke'];

  if (!liver || !dm || !stroke || !eLiverDm || !eDmStroke || !eLiverStroke) return null;

  const isCompact = Boolean(compact);

  function NodeButton({ d }: { d: PropagationDiseaseModel }) {
    const Icon = d.icon;
    const sel = selectedId === d.id;
    return (
      <button
        type="button"
        onClick={() => onSelectDisease(d.id)}
        className={cn(
          'flex min-w-0 flex-col items-center rounded-xl border bg-white text-center shadow-sm transition-all',
          'hover:border-emerald-300 hover:shadow-md',
          isCompact
            ? 'aspect-square w-[9.25rem] min-h-[9.25rem] min-w-[9.25rem] max-h-[9.25rem] max-w-[9.25rem] shrink-0 justify-center gap-2 px-2 py-2 sm:w-[9.75rem] sm:min-h-[9.75rem] sm:min-w-[9.75rem] sm:max-h-[9.75rem] sm:max-w-[9.75rem]'
            : 'max-w-[10rem] gap-2 px-3 py-3 sm:max-w-[10.5rem]',
          sel
            ? 'border-emerald-400 ring-2 ring-emerald-200/90'
            : 'border-gray-200 ring-1 ring-gray-100',
        )}
      >
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-md',
            isCompact ? 'h-12 w-12' : 'h-10 w-10',
            accentIconWrap(d.accent),
          )}
        >
          <Icon className={isCompact ? 'h-6 w-6' : 'h-5 w-5'} strokeWidth={2} />
        </span>
        <div className="w-full min-w-0 px-0.5">
          <p
            className={cn(
              'font-bold uppercase tracking-wide text-gray-500',
              isCompact ? 'text-xs' : 'text-[11px]',
            )}
          >
            {d.shortName}
          </p>
          <p
            className={cn(
              'font-semibold leading-snug text-gray-900',
              isCompact ? 'line-clamp-2 min-h-[2.5rem] text-base' : 'truncate text-xs',
            )}
          >
            {d.fullName}
          </p>
          <span
            className={cn(
              'mt-1 inline-flex rounded-full px-2 font-semibold',
              isCompact ? 'py-0.5 text-xs' : 'py-0.5 text-[10px]',
              riskPill(d.risk),
            )}
          >
            {d.riskLabel}
          </span>
        </div>
      </button>
    );
  }

  return (
    <section
      className={cn(
        'w-full rounded-2xl border border-gray-200 bg-white shadow-sm',
        isCompact ? 'p-4 sm:p-5' : 'p-6',
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-3 border-b border-gray-100',
          isCompact ? 'pb-3' : 'pb-4',
        )}
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
            疾病关联风险传播均值分析
          </h2>
        </div>
      </div>

      <div
        className={cn(
          'rounded-xl border border-gray-100 bg-gray-50/60',
          isCompact ? 'mt-3 p-2 sm:p-3' : 'mt-4 p-3 sm:p-4',
        )}
      >
        <div className={cn('w-full max-w-none', !isCompact && 'mx-auto max-w-4xl')}>
          <div
            ref={chartRef}
            className={cn(
              'relative w-full overflow-visible rounded-lg bg-gradient-to-b from-slate-50/90 via-white to-emerald-50/25 ring-1 ring-slate-200/60',
              'aspect-[420/312] min-h-[252px] sm:min-h-[272px]',
            )}
          >
            <svg
              className="absolute inset-0 z-0 h-full w-full overflow-visible"
              viewBox={`0 0 ${PROP_VB.w} ${PROP_VB.h}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="三病风险 Sankey 风格流带示意，带宽表示相对强度，箭头指向作用目标"
            >
              <defs>
                {triEdges.map((spec) => {
                  const st = strengthStyle(spec.e.impact);
                  const { cubic } = spec;
                  return (
                    <linearGradient
                      key={spec.e.key}
                      id={`${arrowMarkerId}-grad-${spec.e.key}`}
                      gradientUnits="userSpaceOnUse"
                      x1={cubic.x0}
                      y1={cubic.y0}
                      x2={cubic.x3}
                      y2={cubic.y3}
                    >
                      <stop offset="0%" stopColor={st.glow} stopOpacity={0.5} />
                      <stop offset="48%" stopColor={st.stroke} stopOpacity={0.85} />
                      <stop offset="100%" stopColor={st.stroke} stopOpacity={1} />
                    </linearGradient>
                  );
                })}
              </defs>
              {triEdges.map((spec) => {
                const e = spec.e;
                const v = strengthStyle(e.impact);
                const ho = hoverEdgeKey === e.key;
                const gradId = `url(#${arrowMarkerId}-grad-${e.key})`;
                const sw = flowWidth(e.impact);
                const swActive = ho ? sw + 2.5 : sw;
                const pullChord = swActive * 0.55 + 15;
                const { ax, ay, deg: arrowDeg } = arrowAnchorOnCurveCenterline(
                  spec.cubic,
                  pullChord,
                );
                return (
                  <g key={e.key}>
                    <title>
                      {e.key === 'liver-diabetes'
                        ? '肝病 → 糖尿病 风险传播'
                        : e.key === 'diabetes-stroke'
                          ? '糖尿病 → 脑卒中 风险传播'
                          : '肝病 → 脑卒中 风险传播（直接影响）'}
                    </title>
                    <path
                      d={spec.pathD}
                      fill="none"
                      stroke={v.glow}
                      strokeWidth={swActive + FLOW_GLOW_PAD}
                      strokeLinecap="round"
                      opacity={ho ? 0.35 : 0.2}
                      className="pointer-events-none transition-opacity duration-200"
                    />
                    <path
                      d={spec.pathD}
                      fill="none"
                      stroke={gradId}
                      strokeWidth={swActive}
                      strokeLinecap="round"
                      className="pointer-events-none transition-[stroke-width] duration-200"
                    />
                    {/*
                      顶点在 (0,0)、底边在负 x 侧：局部 +x 与切线（指向目标）一致，箭头朝向目标。
                      此前 L 13 … 会把箭头画成指向起点（反了）。
                    */}
                    <g
                      transform={`translate(${ax},${ay}) rotate(${arrowDeg})`}
                      className="pointer-events-none"
                    >
                      <path
                        d="M 0 0 L -12 4.5 L -12 -4.5 Z"
                        fill={v.stroke}
                        stroke="#ffffff"
                        strokeWidth={0.65}
                        strokeLinejoin="round"
                      />
                    </g>
                    <path
                      d={spec.pathD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(36, swActive + 24)}
                      strokeLinecap="round"
                      className="cursor-pointer"
                      onClick={() => onSelectDisease(e.to.id)}
                      onMouseEnter={(ev) => updateEdgeTip(ev, e.key)}
                      onMouseMove={(ev) => updateEdgeTip(ev, e.key)}
                      onMouseLeave={clearEdgeTip}
                    />
                  </g>
                );
              })}
            </svg>
            <div
              className="pointer-events-none absolute inset-0 z-[12]"
              aria-hidden
            >
              {triEdges.map((spec) => {
                const { e, cubic } = spec;
                const st = strengthStyle(e.impact);
                const mid = cubicPoint(cubic, e.key === 'liver-stroke' ? 0.46 : 0.5);
                const lift = e.key === 'liver-stroke' ? '-135%' : '-118%';
                return (
                  <div
                    key={`edge-label-${e.key}`}
                    className="absolute flex min-w-[5.5rem] flex-col items-center gap-0.5 rounded-xl border border-slate-200/90 bg-white/95 px-2.5 py-1.5 text-center shadow-sm backdrop-blur-[1px]"
                    style={{
                      left: `${(mid.x / PROP_VB.w) * 100}%`,
                      top: `${(mid.y / PROP_VB.h) * 100}%`,
                      transform: `translate(-50%, ${lift})`,
                    }}
                  >
                    <span
                      className={cn(
                        'text-[11px] font-semibold tabular-nums tracking-tight',
                        st.labelClass,
                      )}
                    >
                      {`风险↑${e.impact}%`}
                    </span>
                    {e.key === 'liver-stroke' ? (
                      <span className="text-[10px] font-medium leading-none text-slate-500">
                        直接影响
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="pointer-events-none absolute inset-0 z-20">
              <div
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${(PROP_NODE.liver.x / PROP_VB.w) * 100}%`,
                  top: `${(PROP_NODE.liver.y / PROP_VB.h) * 100}%`,
                }}
              >
                <NodeButton d={liver} />
              </div>
              <div
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${(PROP_NODE.diabetes.x / PROP_VB.w) * 100}%`,
                  top: `${(PROP_NODE.diabetes.y / PROP_VB.h) * 100}%`,
                }}
              >
                <NodeButton d={dm} />
              </div>
              <div
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${(PROP_NODE.stroke.x / PROP_VB.w) * 100}%`,
                  top: `${(PROP_NODE.stroke.y / PROP_VB.h) * 100}%`,
                }}
              >
                <NodeButton d={stroke} />
              </div>
            </div>
            {hoverEdgeKey && edgeTipPos ? (
              <div
                className="pointer-events-none absolute z-[35] w-[min(18rem,calc(100%-1rem))] rounded-xl border border-emerald-200/80 bg-white/98 px-3 py-2.5 text-left text-xs leading-relaxed text-slate-700 shadow-lg ring-1 ring-slate-200/70 backdrop-blur-[2px]"
                style={{ left: edgeTipPos.x, top: edgeTipPos.y }}
                role="tooltip"
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800/90">
                  {hoverEdgeKey === 'liver-diabetes'
                    ? '肝病 → 糖尿病'
                    : hoverEdgeKey === 'diabetes-stroke'
                      ? '糖尿病 → 脑卒中'
                      : '肝病 → 脑卒中 · 直接影响'}
                </p>
                <p>{edgeMap[hoverEdgeKey]?.clinicalNote ?? ''}</p>
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] px-2 pb-1.5 pt-10 bg-gradient-to-t from-white/95 via-transparent to-transparent">
              <p className="text-center text-[10px] leading-snug text-slate-400">
                流带越宽传播指数相对越高；三角指向
                <strong className="font-medium text-slate-600">作用目标病种</strong>
                ；<span className="text-slate-500">悬停流带在旁侧查看说明</span>。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
