import React, { useId, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/app/components/ui/utils';

export type PropagationDiseaseId = 'liver' | 'diabetes' | 'stroke';

type RiskLevel = 'low' | 'medium' | 'high';

export interface PropagationDiseaseModel {
  id: PropagationDiseaseId;
  shortName: string;
  fullName: string;
  risk: RiskLevel;
  riskLabel: string;
  probability?: number | null;
  score: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'emerald' | 'red' | 'amber';
}

type EdgeRow = {
  key: string;
  from: PropagationDiseaseModel;
  to: PropagationDiseaseModel;
  impact: number;
  label: string;
  clinicalNote: string;
};

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

/** 传播图连线统一线宽，避免粗线 + marker 叠出圆钝端；强度用配色与百分比表示 */
const PROPAGATION_EDGE_STROKE = 2.75;

/** 用户端紧凑三角图节点中心（与 absolute 百分比一致） */
const PROP_NODE_COMPACT = {
  liver: { x: 52, y: 46 },
  diabetes: { x: 348, y: 46 },
  stroke: { x: 200, y: 178 },
} as const;

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

/** 关联强度指数：<30 绿，30–60 黄，>60 红 */
function strengthStyle(impact: number) {
  if (impact < 30) {
    return {
      stroke: '#10b981',
      strokeWidth: 2.5,
      labelClass: 'text-emerald-800',
    };
  }
  if (impact <= 60) {
    return {
      stroke: '#d97706',
      strokeWidth: 3.5,
      labelClass: 'text-amber-900',
    };
  }
  return {
    stroke: '#e11d48',
    strokeWidth: 5,
    labelClass: 'text-rose-800',
  };
}

/** 深色可视化下的边标签色 */
function strengthLabelOnDark(impact: number) {
  if (impact < 30) return 'text-emerald-300';
  if (impact <= 60) return 'text-amber-300';
  return 'text-rose-300';
}

function FlowChannel({
  edgeKey,
  impact,
  hovered,
}: {
  edgeKey: string;
  impact: number;
  hovered: boolean;
}) {
  const v = strengthStyle(impact);
  const sid = `pf_${edgeKey.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const sw = PROPAGATION_EDGE_STROKE;
  return (
    <svg className="h-8 w-full max-w-[5.5rem] sm:max-w-none" viewBox="0 0 260 28" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`${sid}_g`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={v.stroke} stopOpacity={0.2} />
          <stop offset="55%" stopColor={v.stroke} stopOpacity={0.95} />
          <stop offset="100%" stopColor={v.stroke} />
        </linearGradient>
        <filter id={`${sid}_f`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation={hovered ? 2.8 : 1.4} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <line
        x1="8"
        y1="14"
        x2="232"
        y2="14"
        stroke={`url(#${sid}_g)`}
        strokeWidth={sw}
        strokeLinecap="butt"
        filter={`url(#${sid}_f)`}
        className="risk-prop-flow-line"
      />
      <polygon points="252,14 236,6 236,22" fill={v.stroke} />
    </svg>
  );
}

function quadBezierPoint(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  t: number,
) {
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * cx + t * t * x2,
    y: u * u * y0 + 2 * u * t * cy + t * t * y2,
  };
}

/** 线段两端各缩进 trim，避免连线被节点圆完全遮挡 */
function shortenSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  trimStart: number,
  trimEnd: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x1, y1, x2, y2 };
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: x1 + ux * trimStart,
    y1: y1 + uy * trimStart,
    x2: x2 - ux * trimEnd,
    y2: y2 - uy * trimEnd,
  };
}

/** 标签里不用 Unicode 箭头，避免与 SVG 箭头重复 */
function edgeCaption(label: string) {
  return label.replace(/\s*→\s*/g, ' · ');
}

/** 二次贝塞尔采样后裁掉距两端圆心过近的部分，用于绘制与箭头 */
function trimQuadraticPath(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  r0: number,
  r2: number,
  samples = 48,
): string {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    pts.push(quadBezierPoint(x0, y0, cx, cy, x2, y2, t));
  }
  let i0 = 0;
  for (let i = 0; i <= samples; i++) {
    const d = Math.hypot(pts[i].x - x0, pts[i].y - y0);
    if (d >= r0) {
      i0 = Math.max(0, i - 1);
      break;
    }
  }
  let i1 = samples;
  for (let i = samples; i >= 0; i--) {
    const d = Math.hypot(pts[i].x - x2, pts[i].y - y2);
    if (d >= r2) {
      i1 = Math.min(samples, i + 1);
      break;
    }
  }
  if (i1 <= i0 + 1) {
    const s = shortenSegment(x0, y0, x2, y2, r0, r2);
    return `M ${s.x1} ${s.y1} L ${s.x2} ${s.y2}`;
  }
  const d = [`M ${pts[i0].x} ${pts[i0].y}`];
  for (let i = i0 + 1; i <= i1; i++) {
    d.push(`L ${pts[i].x} ${pts[i].y}`);
  }
  return d.join(' ');
}

function PropagationIntensityComparison({
  edges,
  nodeLabels,
  hoverEdgeKey,
  onHoverEdge,
  onSelectTarget,
}: {
  edges: EdgeRow[];
  nodeLabels: Record<PropagationDiseaseId, string>;
  hoverEdgeKey: string | null;
  onHoverEdge: (key: string | null) => void;
  onSelectTarget: (id: PropagationDiseaseId) => void;
}) {
  const uid = useId().replace(/:/g, '');
  const NODE_R = 26;

  const geom = useMemo(() => {
    const liver = { x: 72, y: 48 };
    const diabetes = { x: 288, y: 48 };
    const stroke = { x: 180, y: 182 };

    const ldmCx = 180;
    const ldmCy = 16;
    const liverDiabetesD = trimQuadraticPath(
      liver.x,
      liver.y,
      ldmCx,
      ldmCy,
      diabetes.x,
      diabetes.y,
      NODE_R,
      NODE_R,
    );
    const ldmMid = quadBezierPoint(liver.x, liver.y, ldmCx, ldmCy, diabetes.x, diabetes.y, 0.38);

    const dsCx = 300;
    const dsCy = 128;
    const diabetesStrokeD = trimQuadraticPath(
      diabetes.x,
      diabetes.y,
      dsCx,
      dsCy,
      stroke.x,
      stroke.y,
      NODE_R,
      NODE_R,
    );
    const dsMid = quadBezierPoint(diabetes.x, diabetes.y, dsCx, dsCy, stroke.x, stroke.y, 0.4);

    const liverStrokeCx = 44;
    const liverStrokeCy = 130;
    const liverStrokeD = trimQuadraticPath(
      liver.x,
      liver.y,
      liverStrokeCx,
      liverStrokeCy,
      stroke.x,
      stroke.y,
      NODE_R,
      NODE_R,
    );
    const lsMid = quadBezierPoint(liver.x, liver.y, liverStrokeCx, liverStrokeCy, stroke.x, stroke.y, 0.48);

    return {
      liver,
      diabetes,
      stroke,
      edgePaths: {
        'liver-diabetes': liverDiabetesD,
        'diabetes-stroke': diabetesStrokeD,
        'liver-stroke': liverStrokeD,
      } as Record<string, string>,
      edgeLabels: {
        'liver-diabetes': { x: ldmMid.x, y: ldmMid.y - 6 },
        'diabetes-stroke': { x: dsMid.x + 10, y: dsMid.y - 6 },
        'liver-stroke': { x: lsMid.x - 6, y: lsMid.y - 6 },
      } as Record<string, { x: number; y: number }>,
    };
  }, [NODE_R]);

  const nodes: Record<PropagationDiseaseId, { x: number; y: number }> = {
    liver: geom.liver,
    diabetes: geom.diabetes,
    stroke: geom.stroke,
  };

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white px-3 py-6 shadow-sm ring-1 ring-gray-100 sm:px-8 sm:py-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        <svg
          className="relative z-[1] mx-auto block h-[min(58vw,300px)] w-full max-w-3xl sm:h-[320px]"
          viewBox="0 0 360 228"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="三病传播强度与通路关系图"
        >
          <defs>
            {edges.map((e) => {
              const v = strengthStyle(e.impact);
              const k = e.key.replace(/-/g, '_');
              const gid = `${uid}_lg_${k}`;
              const mid = `${uid}_mk_${k}`;
              return (
                <React.Fragment key={e.key}>
                  <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="360" y2="228">
                    <stop offset="0%" stopColor={v.stroke} stopOpacity={0.45} />
                    <stop offset="45%" stopColor={v.stroke} stopOpacity={1} />
                    <stop offset="100%" stopColor={v.stroke} stopOpacity={0.55} />
                  </linearGradient>
                  <marker
                    id={mid}
                    markerUnits="userSpaceOnUse"
                    markerWidth="24"
                    markerHeight="24"
                    refX="23"
                    refY="12"
                    orient="auto"
                    overflow="visible"
                  >
                    <path
                      d="M0,1 L0,23 L23,12 Z"
                      fill={v.stroke}
                      shapeRendering="geometricPrecision"
                    />
                  </marker>
                </React.Fragment>
              );
            })}
          </defs>

          {(() => {
            const paintOrder = ['liver-stroke', 'diabetes-stroke', 'liver-diabetes'] as const;
            const rank = (k: string) => {
              const i = paintOrder.indexOf(k as (typeof paintOrder)[number]);
              return i === -1 ? 99 : i;
            };
            return [...edges].sort((a, b) => rank(a.key) - rank(b.key));
          })().map((e) => {
            const pathD = geom.edgePaths[e.key];
            const lab = geom.edgeLabels[e.key];
            if (!pathD || !lab) return null;

            const sw = PROPAGATION_EDGE_STROKE;
            const gid = `${uid}_lg_${e.key.replace(/-/g, '_')}`;
            const mid = `${uid}_mk_${e.key.replace(/-/g, '_')}`;
            const ho = hoverEdgeKey === e.key;
            const opacity = ho ? 1 : 0.92;
            const lx = lab.x;
            const ly = lab.y;
            const cap = edgeCaption(e.label);

            return (
              <g key={e.key}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={`url(#${gid})`}
                  strokeWidth={sw}
                  strokeLinecap="butt"
                  strokeLinejoin="miter"
                  strokeMiterlimit="4"
                  markerEnd={`url(#${mid})`}
                  opacity={opacity}
                />
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={28}
                  strokeLinecap="butt"
                  strokeLinejoin="miter"
                  strokeMiterlimit="4"
                  className="cursor-pointer"
                  onClick={() => onSelectTarget(e.to.id)}
                  onMouseEnter={() => onHoverEdge(e.key)}
                  onMouseLeave={() => onHoverEdge(null)}
                />
                {e.key === 'liver-stroke' ? (
                  <text x={lx} y={ly - 18} textAnchor="middle" fill="#0f766e" fontSize="8.5" fontWeight={700}>
                    直接
                  </text>
                ) : null}
                <text
                  x={lx}
                  y={e.key === 'liver-stroke' ? ly + 2 : ly}
                  textAnchor="middle"
                  fill="#0f172a"
                  fontSize="13"
                  fontWeight={800}
                  className="tabular-nums"
                >
                  {e.impact}%
                </text>
                <text x={lx} y={ly + (e.key === 'liver-stroke' ? 20 : 18)} textAnchor="middle" fill="#475569" fontSize="9.5" fontWeight={600}>
                  {cap}
                </text>
              </g>
            );
          })}

          {(['liver', 'diabetes', 'stroke'] as const).map((id) => {
            const p = nodes[id];
            const label = nodeLabels[id];
            return (
              <g key={id}>
                <circle cx={p.x} cy={p.y} r={NODE_R + 2} fill="none" stroke="rgba(16,185,129,0.2)" strokeWidth="1" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={NODE_R}
                  fill="#ffffff"
                  stroke="rgba(5,150,105,0.45)"
                  strokeWidth={1.5}
                />
                <text
                  x={p.x}
                  y={p.y - 5}
                  textAnchor="middle"
                  fill="#111827"
                  fontSize="12"
                  fontWeight={800}
                  letterSpacing="0.04em"
                >
                  {label}
                </text>
                <text x={p.x} y={p.y + 11} textAnchor="middle" fill="#64748b" fontSize="8.5" fontWeight={600}>
                  {id === 'liver' ? '肝病' : id === 'diabetes' ? '糖尿病' : '脑卒中'}
                </text>
              </g>
            );
          })}
        </svg>

        {hoverEdgeKey ? (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-center text-[11px] leading-relaxed text-gray-700 shadow-lg ring-1 ring-gray-100">
            {edges.find((x) => x.key === hoverEdgeKey)?.clinicalNote ?? ''}
          </div>
        ) : null}
      </div>
    </div>
  );
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

function ArrowSegment({
  edge,
  onSelectTarget,
  onHoverKey,
  hoverEdgeKey,
  compact,
  vizSurface = 'paper',
}: {
  edge: EdgeRow;
  onSelectTarget: (id: PropagationDiseaseId) => void;
  onHoverKey: (key: string | null) => void;
  hoverEdgeKey: string | null;
  compact?: boolean;
  /** analytics：深色大屏风格；paper：原有浅灰卡片 */
  vizSurface?: 'paper' | 'analytics';
}) {
  const v = strengthStyle(edge.impact);
  const hovered = hoverEdgeKey === edge.key;
  const dark = vizSurface === 'analytics' && !compact;

  return (
    <button
      type="button"
      onClick={() => onSelectTarget(edge.to.id)}
      onMouseEnter={() => onHoverKey(edge.key)}
      onMouseLeave={() => onHoverKey(null)}
      className={cn(
        'relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-1 transition-all',
        compact ? 'gap-1.5 py-2' : 'gap-2 py-3',
        dark
          ? hovered
            ? 'bg-teal-500/15 ring-1 ring-teal-400/35'
            : 'hover:bg-white/5'
          : hovered
            ? 'bg-gray-50 ring-1 ring-emerald-200/80'
            : 'hover:bg-gray-50/80',
      )}
    >
      <p
        className={cn(
          'order-1 text-center font-semibold tabular-nums',
          compact ? 'text-[11px] sm:text-xs' : 'text-sm',
          dark ? 'text-slate-200' : 'text-gray-600',
        )}
      >
        ΔRisk&nbsp;
        <span className="font-mono">{edge.impact}</span>%
      </p>
      <div className="order-2 flex w-full max-w-[8rem] items-center justify-center sm:max-w-none">
        {dark ? (
          <FlowChannel edgeKey={edge.key} impact={edge.impact} hovered={hovered} />
        ) : (
          <>
            <div
              className="min-w-0 flex-1 rounded-full opacity-90"
              style={{
                height: Math.max(2, compact ? v.strokeWidth * 0.85 : v.strokeWidth),
                backgroundColor: v.stroke,
                boxShadow: hovered ? `0 0 0 2px ${v.stroke}33` : undefined,
              }}
            />
            <ArrowRight
              className={cn('shrink-0 -translate-x-0.5', compact ? 'h-5 w-5' : 'h-7 w-7')}
              style={{ color: v.stroke }}
              strokeWidth={2.75}
              aria-hidden
            />
          </>
        )}
      </div>
      <p
        className={cn(
          'order-3 text-center font-bold leading-tight',
          compact ? 'text-xs sm:text-sm' : 'text-sm',
          dark ? strengthLabelOnDark(edge.impact) : v.labelClass,
        )}
      >
        {edge.label}
      </p>
      {hovered ? (
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-[min(18rem,calc(100vw-4rem))] -translate-x-1/2 rounded-lg p-2.5 text-left text-sm leading-relaxed shadow-lg',
            dark
              ? 'border border-teal-500/25 bg-slate-900/95 text-slate-200 ring-1 ring-white/10 backdrop-blur-md'
              : 'border border-gray-200 bg-white text-gray-700',
          )}
        >
          {edge.clinicalNote}
        </div>
      ) : null}
    </button>
  );
}

export interface DiseaseRiskPropagationModuleProps {
  diseases: PropagationDiseaseModel[];
  /** [脂肪肝→糖尿病, 糖尿病→脑卒中, 脂肪肝→脑卒中]，由后端返回的可解释传播分值（%） */
  propagationScores?: readonly [number, number, number];
  selectedId: PropagationDiseaseId;
  onSelectDisease: (id: PropagationDiseaseId) => void;
  className?: string;
  /** 首页等场景的简要布局：三病三角顶点 + 三边箭头，无「直接补充」横条 */
  compact?: boolean;
}

export function DiseaseRiskPropagationModule({
  diseases,
  propagationScores,
  selectedId,
  onSelectDisease,
  className,
  compact,
}: DiseaseRiskPropagationModuleProps) {
  const arrowMarkerId = useId().replace(/:/g, '');
  const [hoverEdgeKey, setHoverEdgeKey] = useState<string | null>(null);

  const liver = diseaseById(diseases, 'liver');
  const dm = diseaseById(diseases, 'diabetes');
  const stroke = diseaseById(diseases, 'stroke');

  const edgeRows = useMemo(() => {
    if (!liver || !dm || !stroke) return [];
    const map = { liver, diabetes: dm, stroke };
    return EDGES.map((e) => {
      const from = map[e.from];
      const to = map[e.to];
      const backendImpact =
        e.from === "liver" && e.to === "diabetes"
          ? propagationScores?.[0]
          : e.from === "diabetes" && e.to === "stroke"
            ? propagationScores?.[1]
            : e.from === "liver" && e.to === "stroke"
              ? propagationScores?.[2]
              : undefined;
      const impact =
        backendImpact !== undefined && Number.isFinite(Number(backendImpact))
          ? Math.max(0, Math.min(98, Math.round(Number(backendImpact))))
          : edgePropagationIndex(from.score, to.score, e.pathWeight);
      const label =
        e.from === 'liver' && e.to === 'diabetes'
          ? '脂肪肝→糖尿病'
          : e.from === 'diabetes' && e.to === 'stroke'
            ? '糖尿病→脑卒中'
            : e.from === 'liver' && e.to === 'stroke'
              ? '脂肪肝→脑卒中'
              : `${from.shortName}→${to.shortName}`;
      return {
        key: `${e.from}-${e.to}`,
        from,
        to,
        impact,
        label,
        clinicalNote: e.clinicalNote,
      };
    });
  }, [liver, dm, stroke, propagationScores]);

  const edgeMap = useMemo(() => {
    const m: Record<string, EdgeRow> = {};
    for (const r of edgeRows) m[r.key] = r;
    return m;
  }, [edgeRows]);

  const eLiverDm = edgeMap['liver-diabetes'];
  const eDmStroke = edgeMap['diabetes-stroke'];
  const eLiverStroke = edgeMap['liver-stroke'];

  if (!liver || !dm || !stroke || !eLiverDm || !eDmStroke || !eLiverStroke) return null;

  const isCompact = Boolean(compact);

  function NodeButton({ d }: { d: PropagationDiseaseModel }) {
    const Icon = d.icon;
    const sel = selectedId === d.id;
    const analyticsCard = !isCompact;
    return (
      <button
        type="button"
        onClick={() => onSelectDisease(d.id)}
        className={cn(
          'flex min-w-0 flex-col items-center rounded-xl border text-center transition-all',
          analyticsCard
            ? 'border-gray-200 bg-white shadow-sm ring-1 ring-gray-100 hover:border-emerald-300 hover:shadow-md'
            : 'border-gray-200 bg-white shadow-sm hover:border-emerald-300 hover:shadow-md',
          isCompact
            ? 'aspect-square w-[9.25rem] min-h-[9.25rem] min-w-[9.25rem] max-h-[9.25rem] max-w-[9.25rem] shrink-0 justify-center gap-2 px-2 py-2 sm:w-[9.75rem] sm:min-h-[9.75rem] sm:min-w-[9.75rem] sm:max-h-[9.75rem] sm:max-w-[9.75rem]'
            : 'flex-[1.05] gap-2 px-3 py-3',
          sel
            ? analyticsCard
              ? 'border-emerald-400 ring-2 ring-emerald-200/90'
              : 'border-emerald-400 ring-2 ring-emerald-200/90'
            : analyticsCard
              ? 'border-gray-200 ring-1 ring-gray-100'
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
              'font-bold uppercase tracking-wide',
              isCompact ? 'text-xs' : 'text-[11px]',
              analyticsCard ? 'text-gray-500' : 'text-gray-500',
            )}
          >
            {d.shortName}
          </p>
          <p
            className={cn(
              'font-semibold leading-snug',
              isCompact ? 'line-clamp-2 min-h-[2.5rem] text-base' : 'truncate text-xs',
              analyticsCard ? 'text-gray-900' : 'text-gray-900',
            )}
          >
            {d.fullName}
          </p>
          <span
            className={cn(
              'mt-1 inline-flex rounded-full px-2 font-semibold',
              isCompact ? 'py-0.5 text-xs' : 'py-0.5 text-[10px]',
              analyticsCard ? riskPill(d.risk) : riskPill(d.risk),
            )}
          >
            {d.riskLabel}
          </span>
          <p
            className={cn(
              'mt-1 line-clamp-2',
              isCompact ? 'text-[9px] leading-tight' : 'text-[9px]',
              analyticsCard ? 'text-gray-500' : 'text-gray-500',
            )}
          >
            —
          </p>
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

      {/* 简版：三角布局；完整页：横向主链 + 底边弧线 */}
      <div
        className={cn(
          isCompact ? 'mt-3 rounded-xl border border-gray-100 bg-gray-50/60 p-2 sm:p-3' : 'mt-4',
        )}
      >
        {isCompact ? (
          <div className="w-full max-w-none">
            <div className="relative aspect-[400/248] w-full min-h-[240px]">
              <svg
                className="absolute inset-0 h-full w-full overflow-visible"
                viewBox="0 0 400 248"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden
              >
                <defs>
                  {[eLiverDm, eDmStroke, eLiverStroke].map((ed) => {
                    const st = strengthStyle(ed.impact);
                    return (
                      <marker
                        key={ed.key}
                        id={`${arrowMarkerId}-${ed.key}`}
                        markerUnits="userSpaceOnUse"
                        markerWidth="22"
                        markerHeight="22"
                        refX="19"
                        refY="11"
                        orient="auto"
                        overflow="visible"
                      >
                        <path
                          d="M0,2 L0,20 L19,11 Z"
                          fill={st.stroke}
                          stroke={st.stroke}
                          strokeWidth={0.5}
                          strokeLinejoin="miter"
                        />
                      </marker>
                    );
                  })}
                </defs>
                {(
                  [
                    {
                      e: eLiverDm,
                      ...shortenBetween(
                        PROP_NODE_COMPACT.liver.x,
                        PROP_NODE_COMPACT.liver.y,
                        PROP_NODE_COMPACT.diabetes.x,
                        PROP_NODE_COMPACT.diabetes.y,
                        56,
                        62,
                      ),
                      lx: 0,
                      ly: -16,
                    },
                    {
                      e: eDmStroke,
                      ...shortenBetween(
                        PROP_NODE_COMPACT.diabetes.x,
                        PROP_NODE_COMPACT.diabetes.y,
                        PROP_NODE_COMPACT.stroke.x,
                        PROP_NODE_COMPACT.stroke.y,
                        56,
                        64,
                      ),
                      lx: 14,
                      ly: -11,
                    },
                    {
                      e: eLiverStroke,
                      ...shortenBetween(
                        PROP_NODE_COMPACT.liver.x,
                        PROP_NODE_COMPACT.liver.y,
                        PROP_NODE_COMPACT.stroke.x,
                        PROP_NODE_COMPACT.stroke.y,
                        56,
                        64,
                      ),
                      lx: -16,
                      ly: -12,
                    },
                  ] as const
                ).map(({ e, x1, y1, x2, y2, lx, ly }) => {
                  const v = strengthStyle(e.impact);
                  const mx = (x1 + x2) / 2 + lx;
                  const my = (y1 + y2) / 2 + ly;
                  const ho = hoverEdgeKey === e.key;
                  return (
                    <g key={e.key}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={v.stroke}
                        strokeWidth={PROPAGATION_EDGE_STROKE}
                        strokeLinecap="butt"
                        markerEnd={`url(#${arrowMarkerId}-${e.key})`}
                        opacity={ho ? 1 : 0.95}
                        className="pointer-events-none"
                      />
                      <text
                        x={mx}
                        y={my}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#4b5563"
                        fontSize="9.5"
                        fontWeight={600}
                        className="pointer-events-none select-none"
                      >
                        {`风险↑${e.impact}%`}
                      </text>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="transparent"
                        strokeWidth={26}
                        strokeLinecap="butt"
                        className="cursor-pointer"
                        onClick={() => onSelectDisease(e.to.id)}
                        onMouseEnter={() => setHoverEdgeKey(e.key)}
                        onMouseLeave={() => setHoverEdgeKey(null)}
                      />
                    </g>
                  );
                })}
              </svg>
              <div className="pointer-events-none absolute inset-0 z-10">
                <div
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${(52 / 400) * 100}%`, top: `${(46 / 248) * 100}%` }}
                >
                  <NodeButton d={liver} />
                </div>
                <div
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${(348 / 400) * 100}%`, top: `${(46 / 248) * 100}%` }}
                >
                  <NodeButton d={dm} />
                </div>
                <div
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${(200 / 400) * 100}%`, top: `${(178 / 248) * 100}%` }}
                >
                  <NodeButton d={stroke} />
                </div>
              </div>
            </div>
            {hoverEdgeKey ? (
              <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-700 shadow-sm">
                {edgeMap[hoverEdgeKey]?.clinicalNote ?? ''}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="relative rounded-xl border border-gray-200 bg-gray-50/70 p-4 sm:p-5">
            <div className="relative z-[1] flex flex-col sm:flex-row sm:items-center sm:gap-3">
              <NodeButton d={liver} />
              <ArrowSegment
                edge={eLiverDm}
                onSelectTarget={onSelectDisease}
                onHoverKey={setHoverEdgeKey}
                hoverEdgeKey={hoverEdgeKey}
                compact={false}
                vizSurface="paper"
              />
              <NodeButton d={dm} />
              <ArrowSegment
                edge={eDmStroke}
                onSelectTarget={onSelectDisease}
                onHoverKey={setHoverEdgeKey}
                hoverEdgeKey={hoverEdgeKey}
                compact={false}
                vizSurface="paper"
              />
              <NodeButton d={stroke} />
            </div>

            <PropagationIntensityComparison
              edges={[eLiverDm, eDmStroke, eLiverStroke]}
              nodeLabels={{
                liver: liver.shortName,
                diabetes: dm.shortName,
                stroke: stroke.shortName,
              }}
              hoverEdgeKey={hoverEdgeKey}
              onHoverEdge={setHoverEdgeKey}
              onSelectTarget={onSelectDisease}
            />

            <div className="relative z-[1] mt-3 flex flex-wrap items-center justify-end gap-3 text-[9px] text-gray-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-emerald-200" />
                {'弱关联 <30'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 ring-1 ring-amber-200" />
                中 30–60
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500 ring-1 ring-rose-200" />
                {'强 >60'}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
