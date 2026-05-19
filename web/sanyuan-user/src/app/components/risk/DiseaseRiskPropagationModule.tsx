import React, { useId, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Lightbulb, MessageSquare, ShieldCheck } from 'lucide-react';
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
  /** 图示旁短文案：言简意赅，与参考模板风格一致 */
  summaryZh: string;
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

/** 用户端紧凑三角图节点中心：左脂肪肝、右糖尿病、下脑卒中（简版 dashboard 用） */
const PROP_NODE_COMPACT = {
  liver: { x: 52, y: 46 },
  diabetes: { x: 348, y: 46 },
  stroke: { x: 200, y: 178 },
} as const;

/** 完整页传播图：三等分圆上的节点；连线为同圆外接短弧；viewBox 加大使边注可放在弧外侧、不压线 */
const PROP_TRIANGLE_CIRCLE = {
  vbW: 680,
  vbH: 500,
  cx: 340,
  cy: 238,
  R: 112,
  /** 注释锚点半径 = R + extra，取较大值使白底卡片整体落在弧外法向，避免遮挡弧线 */
  labelRadiusExtra: { diabetesLiver: 86, liverStroke: 102, diabetesStroke: 102 } as const,
  /** 0°=+x 右，90°=+y 下 */
  ang: { diabetes: -30, liver: 210, stroke: 90 } as const,
  /** 透明命中弧：略缩进即可，便于整条弧可点 */
  trimDegHit: 6,
  /** 可见弧 + 箭头：端点再沿圆缩进，避免 marker 落在节点白底（z-10）下被遮住 */
  trimDegVis: 22,
} as const;

function triangleDegXY(R: number, deg: number) {
  const t = (deg * Math.PI) / 180;
  return {
    x: PROP_TRIANGLE_CIRCLE.cx + R * Math.cos(t),
    y: PROP_TRIANGLE_CIRCLE.cy + R * Math.sin(t),
  };
}

/** 圆上从 startDeg 到 endDeg：clockwise=true 取顺时针方向的短弧（与 SVG y 向下时 sweep=0 为顺时针一致） */
function svgCircularArc(R: number, startDeg: number, endDeg: number, clockwise: boolean): string {
  const p0 = triangleDegXY(R, startDeg);
  const p1 = triangleDegXY(R, endDeg);
  let span: number;
  if (clockwise) {
    span = (startDeg - endDeg + 360) % 360;
  } else {
    span = (endDeg - startDeg + 360) % 360;
  }
  if (span === 0) span = 360;
  const large: 0 | 1 = span > 180 ? 1 : 0;
  /** SVG：sweep=0 为顺时针（y 轴向下），此前与 clockwise 同号导致弧朝三角形内侧，改为取反 */
  const sweep: 0 | 1 = clockwise ? 0 : 1;
  return `M ${p0.x} ${p0.y} A ${R} ${R} 0 ${large} ${sweep} ${p1.x} ${p1.y}`;
}

/** 与 svgCircularArc 同向：在弧上按参数 t∈[0,1] 插值角度，t=0 为起点、t=1 为终点 */
function arcInterpDeg(startDeg: number, endDeg: number, clockwise: boolean, t: number): number {
  const u = Math.min(1, Math.max(0, t));
  if (clockwise) {
    let span = (startDeg - endDeg + 360) % 360;
    if (span === 0) span = 360;
    return startDeg - u * span;
  }
  let span = (endDeg - startDeg + 360) % 360;
  if (span === 0) span = 360;
  return startDeg + u * span;
}

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

/** 标签里不用 Unicode 箭头，避免与 SVG 箭头重复 */
function edgeCaption(label: string) {
  return label.replace(/\s*→\s*/g, ' · ');
}

function TriangleFlowNode({
  d,
  styleLeftPct,
  styleTopPct,
  onSelect,
}: {
  d: PropagationDiseaseModel;
  styleLeftPct: number;
  styleTopPct: number;
  onSelect: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${styleLeftPct}%`, top: `${styleTopPct}%` }}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
        'group flex min-w-[7.25rem] flex-col items-center gap-1.5 rounded-2xl border border-teal-600/30 bg-white px-4 py-3 text-center',
        'shadow-sm ring-1 ring-slate-900/[0.04] transition duration-200 ease-out',
          'hover:border-teal-600/55 hover:shadow-md hover:ring-teal-600/10',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500',
          'active:scale-[0.99]',
        )}
      >
        <span className="text-[13px] font-bold tracking-wide text-teal-950 group-hover:text-teal-900">
          {d.shortName}
        </span>
        <span className="text-[11px] font-medium leading-snug text-slate-600 group-hover:text-slate-700">
          {d.fullName}
        </span>
      </button>
    </div>
  );
}

/** 完整页：三等分圆上节点 + 同圆三段短弧（糖→肝、肝→卒、糖→卒直接） */
function PropagationDiseaseTriangleFlow({
  uid,
  eDmLiver,
  eLiverStroke,
  eDmStroke,
  hoverEdgeKey,
  onHoverEdge,
  onSelectTarget,
}: {
  uid: string;
  eDmLiver: EdgeRow;
  eLiverStroke: EdgeRow;
  eDmStroke: EdgeRow;
  hoverEdgeKey: string | null;
  onHoverEdge: (key: string | null) => void;
  onSelectTarget: (id: PropagationDiseaseId) => void;
}) {
  const dm = eDmLiver.from;
  const liver = eDmLiver.to;
  const stroke = eLiverStroke.to;

  const { vbW, vbH, cx, cy, R, ang, trimDegHit, trimDegVis, labelRadiusExtra } = PROP_TRIANGLE_CIRCLE;

  const ringLayout = useMemo(() => {
    const th = trimDegHit;
    const tv = trimDegVis;
    const pathDmLiverVis = svgCircularArc(R, ang.diabetes - tv, ang.liver + tv, true);
    const pathLiverStrokeVis = svgCircularArc(R, ang.liver - tv, ang.stroke + tv, true);
    const pathDmStrokeVis = svgCircularArc(R, ang.diabetes + tv, ang.stroke - tv, false);
    const pathDmLiverHit = svgCircularArc(R, ang.diabetes - th, ang.liver + th, true);
    const pathLiverStrokeHit = svgCircularArc(R, ang.liver - th, ang.stroke + th, true);
    const pathDmStrokeHit = svgCircularArc(R, ang.diabetes + th, ang.stroke - th, false);

    function edgeNoteAnchor(
      e: EdgeRow,
      startDeg: number,
      endDeg: number,
      clockwise: boolean,
      layoutCx: number,
      layoutCy: number,
    ) {
      const tAlong = 0.46;
      const mid = arcInterpDeg(startDeg, endDeg, clockwise, tAlong);
      const ex =
        e.key === 'diabetes-liver'
          ? labelRadiusExtra.diabetesLiver
          : e.key === 'liver-stroke'
            ? labelRadiusExtra.liverStroke
            : labelRadiusExtra.diabetesStroke;
      let { x, y } = triangleDegXY(R + ex, mid);
      const rdx = x - layoutCx;
      const rdy = y - layoutCy;
      const rlen = Math.hypot(rdx, rdy) || 1;
      const radialBump = e.key === 'diabetes-liver' ? 36 : 48;
      x += (rdx / rlen) * radialBump;
      y += (rdy / rlen) * radialBump;
      if (e.key === 'diabetes-liver') {
        /** 顶边注略下移：避免裁切，并与上方三角节点间距更紧凑 */
        y += 28;
      } else if (e.key === 'liver-stroke') {
        x -= 14;
        y -= 6;
      } else {
        x += 14;
        y -= 6;
      }
      return {
        key: e.key,
        edgeLabel: e.label,
        text: e.clinicalNote,
        impact: e.impact,
        x,
        y,
        translateClass: '-translate-x-1/2 -translate-y-1/2' as const,
      };
    }

    const edgeNotes = [
      edgeNoteAnchor(eDmLiver, ang.diabetes - tv, ang.liver + tv, true, cx, cy),
      edgeNoteAnchor(eLiverStroke, ang.liver - tv, ang.stroke + tv, true, cx, cy),
      edgeNoteAnchor(eDmStroke, ang.diabetes + tv, ang.stroke - tv, false, cx, cy),
    ] as const;

    return {
      paths: [
        { e: eDmLiver, dVis: pathDmLiverVis, dHit: pathDmLiverHit },
        { e: eLiverStroke, dVis: pathLiverStrokeVis, dHit: pathLiverStrokeHit },
        { e: eDmStroke, dVis: pathDmStrokeVis, dHit: pathDmStrokeHit },
      ] as const,
      edgeNotes,
      nodes: {
        diabetes: triangleDegXY(R, ang.diabetes),
        liver: triangleDegXY(R, ang.liver),
        stroke: triangleDegXY(R, ang.stroke),
      },
    };
  }, [R, cx, cy, ang.diabetes, ang.liver, ang.stroke, trimDegHit, trimDegVis, labelRadiusExtra, eDmLiver, eLiverStroke, eDmStroke]);

  const markerSuffix = (k: string) => k.replace(/[^a-zA-Z0-9]/g, '_');

  return (
    <div
      className="relative mx-auto w-full max-w-[min(97vw,680px)]"
      style={{ aspectRatio: `${vbW} / ${vbH}`, minHeight: 320 }}
    >
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="三病传播关系：三边为同一外接圆上的圆弧，依次为糖尿病至脂肪肝、脂肪肝至脑卒中、糖尿病至脑卒中直接路径"
      >
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="1" strokeDasharray="5 8" />
        <defs>
          {ringLayout.paths.map(({ e }) => {
            const st = strengthStyle(e.impact);
            return (
              <marker
                key={e.key}
                id={`${uid}_tri_${markerSuffix(e.key)}`}
                markerUnits="userSpaceOnUse"
                markerWidth="20"
                markerHeight="20"
                refX="17.2"
                refY="10"
                orient="auto"
                overflow="visible"
              >
                <path
                  d="M0,1.5 L0,18.5 L17,10 Z"
                  fill={st.stroke}
                  stroke={st.stroke}
                  strokeWidth={0.35}
                  strokeLinejoin="round"
                />
              </marker>
            );
          })}
        </defs>
        {ringLayout.paths.map(({ e, dVis, dHit }) => {
          const v = strengthStyle(e.impact);
          const ho = hoverEdgeKey === e.key;
          return (
            <g key={e.key}>
              <path
                d={dVis}
                fill="none"
                stroke={v.stroke}
                strokeWidth={PROPAGATION_EDGE_STROKE + (ho ? 0.75 : 0)}
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd={`url(#${uid}_tri_${markerSuffix(e.key)})`}
                opacity={ho ? 1 : 0.92}
                className="pointer-events-none transition-[stroke-width,opacity] duration-200"
              />
              <path
                d={dHit}
                fill="none"
                stroke="transparent"
                strokeWidth={28}
                strokeLinecap="round"
                className="cursor-pointer"
                onClick={() => onSelectTarget(e.to.id)}
                onMouseEnter={() => onHoverEdge(e.key)}
                onMouseLeave={() => onHoverEdge(null)}
              />
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 z-[11]">
        {ringLayout.edgeNotes.map((n) => {
          const ho = hoverEdgeKey === n.key;
          const st = strengthStyle(n.impact);
          return (
            <div
              key={n.key}
              role="note"
              aria-label={`${n.edgeLabel}：${n.text}`}
              className={cn(
                'absolute max-w-[min(12rem,38vw)] rounded-lg border border-gray-200/90 bg-white/95 px-2.5 py-2 text-left shadow-sm ring-1 ring-slate-900/[0.04] transition-[box-shadow,ring-color,border-color] duration-200',
                n.translateClass,
                ho ? 'shadow-md ring-2' : '',
              )}
              style={{
                left: `${(n.x / vbW) * 100}%`,
                top: `${(n.y / vbH) * 100}%`,
                ...(ho ? { borderColor: st.stroke, boxShadow: `0 4px 14px ${st.stroke}22` } : {}),
              }}
            >
              <p className="text-[10px] font-bold leading-tight text-gray-900">{n.edgeLabel}</p>
              <p className="mt-1 text-[10px] leading-snug text-gray-600">{n.text}</p>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-none absolute inset-0">
          <TriangleFlowNode
            d={liver}
            styleLeftPct={(ringLayout.nodes.liver.x / vbW) * 100}
            styleTopPct={(ringLayout.nodes.liver.y / vbH) * 100}
            onSelect={() => onSelectTarget(liver.id)}
          />
          <TriangleFlowNode
            d={dm}
            styleLeftPct={(ringLayout.nodes.diabetes.x / vbW) * 100}
            styleTopPct={(ringLayout.nodes.diabetes.y / vbH) * 100}
            onSelect={() => onSelectTarget(dm.id)}
          />
          <TriangleFlowNode
            d={stroke}
            styleLeftPct={(ringLayout.nodes.stroke.x / vbW) * 100}
            styleTopPct={(ringLayout.nodes.stroke.y / vbH) * 100}
            onSelect={() => onSelectTarget(stroke.id)}
          />
        </div>
      </div>
    </div>
  );
}

function PropagationCalloutHexPanel({
  edge,
  Icon,
  hexTone,
  textSide,
  hovered,
  onHover,
  onSelectTarget,
}: {
  edge: EdgeRow;
  Icon: LucideIcon;
  hexTone: 'sky' | 'amber' | 'emerald';
  textSide: 'right' | 'left';
  hovered: boolean;
  onHover: (key: string | null) => void;
  onSelectTarget: (id: PropagationDiseaseId) => void;
}) {
  const v = strengthStyle(edge.impact);
  const cap = edgeCaption(edge.label);
  const hexBg =
    hexTone === 'amber'
      ? 'bg-gradient-to-br from-amber-100 via-orange-300 to-orange-500 ring-1 ring-orange-200/80'
      : hexTone === 'emerald'
        ? 'bg-gradient-to-br from-emerald-100 via-emerald-400 to-teal-600 ring-1 ring-emerald-200/80'
        : 'bg-gradient-to-br from-sky-100 via-sky-300 to-blue-600 ring-1 ring-sky-200/80';

  return (
    <button
      type="button"
      onClick={() => onSelectTarget(edge.to.id)}
      onMouseEnter={() => onHover(edge.key)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'w-full rounded-2xl border bg-white/95 px-3.5 py-3 text-left shadow-md ring-1 transition-all',
        hovered
          ? hexTone === 'amber'
            ? 'border-orange-300 ring-2 ring-orange-200/90 shadow-lg'
            : hexTone === 'emerald'
              ? 'border-emerald-300 ring-2 ring-emerald-200/90 shadow-lg'
              : 'border-sky-300 ring-2 ring-sky-200/90 shadow-lg'
          : 'border-gray-200/90 ring-gray-100 hover:border-gray-300',
      )}
      style={{ borderTopWidth: 3, borderTopColor: v.stroke }}
    >
      <div
        className={cn(
          'flex items-start gap-3',
          textSide === 'left' ? 'flex-row-reverse' : 'flex-row',
        )}
      >
        <div
          className={cn(
            'flex h-[52px] w-[46px] shrink-0 items-center justify-center text-white shadow-md',
            hexBg,
          )}
          style={{
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          }}
        >
          <Icon className="h-5 w-5 drop-shadow" strokeWidth={2.25} aria-hidden />
        </div>
        <div
          className={cn(
            'min-w-0 flex-1 pt-0.5',
            textSide === 'right' ? 'text-right' : 'text-left',
          )}
        >
          <p className={cn('text-[13px] font-bold leading-snug text-gray-900', textSide === 'right' && 'text-right')}>
            <span className="tabular-nums font-extrabold text-gray-950">{edge.impact}%</span>
            <span className="mx-1.5 text-gray-400">·</span>
            <span>{cap}</span>
            {edge.key === 'diabetes-stroke' ? (
              <span className="ml-1.5 align-middle text-[10px] font-semibold text-amber-800">直接</span>
            ) : null}
          </p>
          <p
            className={cn(
              'mt-2 text-[11px] leading-relaxed text-gray-600',
              textSide === 'right' && 'text-right',
            )}
          >
            {edge.summaryZh}
          </p>
          <p
            className={cn(
              'mt-2.5 border-t border-gray-100 pt-2 text-[10px] leading-snug text-gray-500',
              textSide === 'right' && 'text-right',
            )}
          >
            以上为当前评估之要点提炼，宜简明跟踪、定期复评；个体情况请以临床沟通为准。
          </p>
        </div>
      </div>
    </button>
  );
}

function PropagationIntensityComparison({
  edges,
  hoverEdgeKey,
  onHoverEdge,
  onSelectTarget,
}: {
  edges: EdgeRow[];
  hoverEdgeKey: string | null;
  onHoverEdge: (key: string | null) => void;
  onSelectTarget: (id: PropagationDiseaseId) => void;
}) {
  const uid = useId().replace(/:/g, '');

  const edgeByKey = useMemo(() => {
    const m: Record<string, EdgeRow> = {};
    for (const e of edges) m[e.key] = e;
    return m;
  }, [edges]);

  const eDmLiver = edgeByKey['diabetes-liver'];
  const eLiverStroke = edgeByKey['liver-stroke'];
  const eDmStroke = edgeByKey['diabetes-stroke'];

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white px-3 py-6 shadow-sm ring-1 ring-gray-100 sm:px-5 sm:py-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative z-[1] mx-auto flex max-w-5xl flex-col items-center px-1 sm:px-2">
          {eDmLiver && eLiverStroke && eDmStroke ? (
            <PropagationDiseaseTriangleFlow
              uid={uid}
              eDmLiver={eDmLiver}
              eLiverStroke={eLiverStroke}
              eDmStroke={eDmStroke}
              hoverEdgeKey={hoverEdgeKey}
              onHoverEdge={onHoverEdge}
              onSelectTarget={onSelectTarget}
            />
          ) : null}
          <p className="mt-4 max-w-md text-center text-[10px] leading-relaxed text-gray-500">
            三边为同一外接圆上的圆弧，合围成环：糖尿病→脂肪肝→脑卒中，以及糖尿病→脑卒中直接路径；线色表示关联强度（见下方图例）。
          </p>
        </div>
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
  summaryZh: string;
}[] = [
  {
    from: 'diabetes',
    to: 'liver',
    pathWeight: 0.92,
    clinicalNote:
      '长期高血糖与胰岛素抵抗可加重肝脏脂肪沉积，糖尿病与脂肪肝常并存并相互促进，需同步管理糖代谢与肝脏脂肪。',
    summaryZh:
      '高糖与胰岛素抵抗可推动肝脂沉积，两病并存时常相互加重；扼要把握「降糖护肝一体管理」，有助于打断彼此强化。',
  },
  {
    from: 'liver',
    to: 'stroke',
    pathWeight: 0.58,
    clinicalNote:
      'NAFLD 相关慢性炎症、血脂紊乱与高血压等可共同参与动脉粥样硬化，间接影响脑血管事件风险。',
    summaryZh:
      '慢性炎症与血脂、血压紊乱共同参与动脉硬化，脂肪肝与卒中之间存在间接却不可忽视的通路；宜结合整体心血管负荷理解。',
  },
  {
    from: 'diabetes',
    to: 'stroke',
    pathWeight: 1.05,
    clinicalNote:
      '长期高血糖损伤血管内皮、促进动脉硬化，是缺血性脑卒中的重要可干预危险因素。',
    summaryZh:
      '长期高血糖损伤血管内皮并推动动脉硬化，卒中风险随之抬升；要点在于规范控糖并与压脂管理协同推进。',
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
  /** [糖尿病→脂肪肝, 脂肪肝→脑卒中, 糖尿病→脑卒中]，由后端返回的可解释传播分值（%） */
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
        e.from === 'diabetes' && e.to === 'liver'
          ? propagationScores?.[0]
          : e.from === 'liver' && e.to === 'stroke'
            ? propagationScores?.[1]
            : e.from === 'diabetes' && e.to === 'stroke'
              ? propagationScores?.[2]
              : undefined;
      const impact =
        backendImpact !== undefined && Number.isFinite(Number(backendImpact))
          ? Math.max(0, Math.min(98, Math.round(Number(backendImpact))))
          : edgePropagationIndex(from.score, to.score, e.pathWeight);
      const label =
        e.from === 'diabetes' && e.to === 'liver'
          ? '糖尿病→脂肪肝'
          : e.from === 'liver' && e.to === 'stroke'
            ? '脂肪肝→脑卒中'
            : e.from === 'diabetes' && e.to === 'stroke'
              ? '糖尿病→脑卒中'
              : `${from.shortName}→${to.shortName}`;
      return {
        key: `${e.from}-${e.to}`,
        from,
        to,
        impact,
        label,
        clinicalNote: e.clinicalNote,
        summaryZh: e.summaryZh,
      };
    });
  }, [liver, dm, stroke, propagationScores]);

  const edgeMap = useMemo(() => {
    const m: Record<string, EdgeRow> = {};
    for (const r of edgeRows) m[r.key] = r;
    return m;
  }, [edgeRows]);

  const eDmLiver = edgeMap['diabetes-liver'];
  const eDmStroke = edgeMap['diabetes-stroke'];
  const eLiverStroke = edgeMap['liver-stroke'];

  if (!liver || !dm || !stroke || !eDmLiver || !eDmStroke || !eLiverStroke) return null;

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
                  {[eDmLiver, eLiverStroke, eDmStroke].map((ed) => {
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
                      e: eDmLiver,
                      ...shortenBetween(
                        PROP_NODE_COMPACT.diabetes.x,
                        PROP_NODE_COMPACT.diabetes.y,
                        PROP_NODE_COMPACT.liver.x,
                        PROP_NODE_COMPACT.liver.y,
                        56,
                        62,
                      ),
                      lx: 0,
                      ly: -16,
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
                      lx: 14,
                      ly: -11,
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
              <NodeButton d={dm} />
              <ArrowSegment
                edge={eDmLiver}
                onSelectTarget={onSelectDisease}
                onHoverKey={setHoverEdgeKey}
                hoverEdgeKey={hoverEdgeKey}
                compact={false}
                vizSurface="paper"
              />
              <NodeButton d={liver} />
              <ArrowSegment
                edge={eLiverStroke}
                onSelectTarget={onSelectDisease}
                onHoverKey={setHoverEdgeKey}
                hoverEdgeKey={hoverEdgeKey}
                compact={false}
                vizSurface="paper"
              />
              <NodeButton d={stroke} />
            </div>

            <PropagationIntensityComparison
              edges={[eDmLiver, eLiverStroke, eDmStroke]}
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
