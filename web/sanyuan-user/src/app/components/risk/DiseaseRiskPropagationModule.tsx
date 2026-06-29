import React, { useId, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Lightbulb, MessageSquare, ShieldCheck } from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import type { PropagationEdgeDetail, RiskPredictResponse } from '@/lib/api/riskPredict';

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
  /** 数据密度权重等解释（后端 propagationDetail） */
  dualLayer?: PropagationEdgeDetail;
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

/** 传播图连线统一线宽（简版/横向条）；强度用配色与百分比表示 */
const PROPAGATION_EDGE_STROKE = 2.75;
/** 完整页三角传播弧：线宽略大，与缩小后的病节点形成对比 */
const PROP_TRIANGLE_EDGE_STROKE = 4.5;

/** 用户端紧凑三角图节点中心：左脂肪肝、右糖尿病、下脑卒中（简版 dashboard 用） */
const PROP_NODE_COMPACT = {
  liver: { x: 52, y: 46 },
  diabetes: { x: 348, y: 46 },
  stroke: { x: 200, y: 178 },
} as const;

/** 完整页传播图：三等分圆上的节点；连线为同圆外接短弧 */
const PROP_TRIANGLE_CIRCLE = {
  vbW: 680,
  vbH: 500,
  cx: 340,
  cy: 238,
  /** 节点中心所在参考圆半径（与虚线圆一致） */
  R: 132,
  /** 0°=+x 右，90°=+y 下；左脂肪肝、右糖尿病、下脑卒中 */
  ang: { liver: 210, diabetes: -30, stroke: 90 } as const,
  trimDegHit: 6,
  trimDegVis: 22,
  trimDegVisStrokeEnd: 10,
} as const;

/** 7rem 圆节点在设计宽 680px 下约 56 viewBox 半径；含边框/ring 可视外缘约 57 */
const PROP_TRIANGLE_NODE_R_VB = 57;
/** 箭头 marker 尖端至附着点距离（与 marker refX 一致） */
const PROP_TRIANGLE_MARKER_TIP_LEN = 18;

function triangleOrbitR(): number {
  return PROP_TRIANGLE_CIRCLE.R;
}

/** 弧线沿虚线参考圆绘制，首尾在节点圆与参考圆相切点 */
function triangleArcR(): number {
  return triangleOrbitR();
}

/** 节点圆与参考圆相交时的角向半宽（度），路径端点落在此角上即贴节点外缘 */
function triangleNodeContactDeg(arcR: number, nodeR: number = PROP_TRIANGLE_NODE_R_VB): number {
  const ratio = Math.min(1, nodeR / (2 * arcR));
  return (2 * Math.asin(ratio) * 180) / Math.PI;
}

function triangleOrbitBoundaryDeg(
  nodeOrbitDeg: number,
  towardIncreasingAngle: boolean,
  arcR: number,
): number {
  const contact = triangleNodeContactDeg(arcR);
  return towardIncreasingAngle ? nodeOrbitDeg + contact : nodeOrbitDeg - contact;
}

function triangleDegXY(R: number, deg: number) {
  const t = (deg * Math.PI) / 180;
  return {
    x: PROP_TRIANGLE_CIRCLE.cx + R * Math.cos(t),
    y: PROP_TRIANGLE_CIRCLE.cy + R * Math.sin(t),
  };
}

/** clipPath：全画布减去三枚节点圆，裁掉线宽/箭头穿入圆内的部分 */
function triangleNodesClipPathD(
  nodes: { liver: { x: number; y: number }; diabetes: { x: number; y: number }; stroke: { x: number; y: number } },
  vbW: number,
  vbH: number,
  nodeR: number,
): string {
  const hole = (x: number, y: number) =>
    `M ${x + nodeR},${y} a ${nodeR},${nodeR} 0 1,0 ${-2 * nodeR},0 a ${nodeR},${nodeR} 0 1,0 ${2 * nodeR},0 Z`;
  return [
    `M 0,0 H ${vbW} V ${vbH} H 0 Z`,
    hole(nodes.liver.x, nodes.liver.y),
    hole(nodes.diabetes.x, nodes.diabetes.y),
    hole(nodes.stroke.x, nodes.stroke.y),
  ].join(' ');
}

/** 三条有向边的起止角（clockwise=true 为角度递减方向） */
function triangleEdgeArcAngles(
  edgeKey: 'liver-diabetes' | 'liver-stroke' | 'diabetes-stroke',
  arcR: number,
): { startDeg: number; endDeg: number; clockwise: boolean; markerAtEnd: boolean } {
  const { ang } = PROP_TRIANGLE_CIRCLE;
  if (edgeKey === 'liver-diabetes') {
    /** 顶弧 CCW（角度增大）：脂肪肝 +contact 出、糖尿病 -contact 入，端点贴外缘 */
    return {
      startDeg: triangleOrbitBoundaryDeg(ang.liver, true, arcR),
      endDeg: triangleOrbitBoundaryDeg(ang.diabetes, false, arcR),
      clockwise: false,
      markerAtEnd: true,
    };
  }
  if (edgeKey === 'liver-stroke') {
    return {
      startDeg: triangleOrbitBoundaryDeg(ang.liver, false, arcR),
      endDeg: triangleOrbitBoundaryDeg(ang.stroke, true, arcR),
      clockwise: true,
      markerAtEnd: true,
    };
  }
  return {
    startDeg: triangleOrbitBoundaryDeg(ang.diabetes, true, arcR),
    endDeg: triangleOrbitBoundaryDeg(ang.stroke, false, arcR),
    clockwise: false,
    markerAtEnd: true,
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

/** 传播箭头默认绿色；悬停时高亮为黄色（不再按关联强度分色） */
const PROP_EDGE_COLOR = '#10b981';
const PROP_EDGE_COLOR_HOVER = '#eab308';

function edgeArrowStyle(hovered = false) {
  return {
    stroke: hovered ? PROP_EDGE_COLOR_HOVER : PROP_EDGE_COLOR,
    strokeWidth: PROPAGATION_EDGE_STROKE,
    labelClass: hovered ? 'text-yellow-600' : 'text-emerald-800',
  };
}

/** 深色可视化下的边标签色 */
function edgeLabelOnDark(hovered: boolean) {
  return hovered ? 'text-yellow-300' : 'text-emerald-300';
}

function FlowChannel({
  edgeKey,
  hovered,
}: {
  edgeKey: string;
  hovered: boolean;
}) {
  const v = edgeArrowStyle(hovered);
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

/** 悬停传播弧时，弧线旁统一形态的说明卡片（与横向 ArrowSegment 浮层区分） */
const PROP_ARC_CALLOUT_CLASS =
  'pointer-events-auto absolute w-[min(15rem,40vw)] rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left text-sm shadow-md ring-1 ring-gray-100/90';

function PropagationArcCallout({
  edgeLabel,
  text,
  accentStroke,
  style,
  translateClass,
  onHoverEdge,
  edgeKey,
  dualLayer,
}: {
  edgeLabel: string;
  text: string;
  accentStroke: string;
  style: React.CSSProperties;
  translateClass: string;
  onHoverEdge: (key: string | null) => void;
  edgeKey: string;
  dualLayer?: PropagationEdgeDetail;
}) {
  return (
    <div
      role="note"
      aria-label={`${edgeLabel}：${text}`}
      className={cn(PROP_ARC_CALLOUT_CLASS, translateClass)}
      style={style}
      onMouseEnter={() => onHoverEdge(edgeKey)}
      onMouseLeave={() => onHoverEdge(null)}
    >
      <div className="mb-1.5 h-0.5 w-8 rounded-full" style={{ backgroundColor: accentStroke }} aria-hidden />
      <p className="text-sm font-bold leading-tight text-gray-900">{edgeLabel}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{text}</p>
    </div>
  );
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
          'group flex h-[7rem] w-[7rem] flex-col items-center justify-center gap-1 rounded-full border border-teal-600/35 bg-white px-2 text-center',
          'shadow-sm ring-1 ring-teal-600/10 transition duration-200 ease-out',
          'hover:border-teal-600/55 hover:shadow-md hover:ring-teal-600/15',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500',
          'active:scale-[0.99]',
        )}
      >
        <span className="text-base font-bold tracking-wide text-teal-950 group-hover:text-teal-900">
          {d.shortName}
        </span>
        <span className="max-w-[5.5rem] text-xs font-medium leading-snug text-slate-600 group-hover:text-slate-700">
          {d.fullName}
        </span>
      </button>
    </div>
  );
}

/** 完整页：三等分圆上节点 + 同圆三段短弧（肝→糖、肝→卒、糖→卒直接） */
function PropagationDiseaseTriangleFlow({
  uid,
  eLiverDm,
  eLiverStroke,
  eDmStroke,
  hoverEdgeKey,
  onHoverEdge,
  onSelectTarget,
}: {
  uid: string;
  eLiverDm: EdgeRow;
  eLiverStroke: EdgeRow;
  eDmStroke: EdgeRow;
  hoverEdgeKey: string | null;
  onHoverEdge: (key: string | null) => void;
  onSelectTarget: (id: PropagationDiseaseId) => void;
}) {
  const liver = eLiverDm.from;
  const dm = eLiverDm.to;
  const stroke = eLiverStroke.to;

  const { vbW, vbH, cx, cy, ang, trimDegHit } = PROP_TRIANGLE_CIRCLE;
  const orbitR = triangleOrbitR();
  const arcR = triangleArcR();

  const ringLayout = useMemo(() => {
    const arcLiverDm = triangleEdgeArcAngles('liver-diabetes', arcR);
    const arcLiverStroke = triangleEdgeArcAngles('liver-stroke', arcR);
    const arcDmStroke = triangleEdgeArcAngles('diabetes-stroke', arcR);

    const hitPad = Math.max(4, trimDegHit);
    const hitLiverDm = {
      startDeg: arcLiverDm.startDeg + (arcLiverDm.clockwise ? hitPad : -hitPad),
      endDeg: arcLiverDm.endDeg - (arcLiverDm.clockwise ? hitPad : -hitPad),
      clockwise: arcLiverDm.clockwise,
    };
    const hitLiverStroke = {
      startDeg: arcLiverStroke.startDeg + (arcLiverStroke.clockwise ? hitPad : -hitPad),
      endDeg: arcLiverStroke.endDeg - (arcLiverStroke.clockwise ? hitPad : -hitPad),
      clockwise: arcLiverStroke.clockwise,
    };
    const hitDmStroke = {
      startDeg: arcDmStroke.startDeg + (arcDmStroke.clockwise ? -hitPad : hitPad),
      endDeg: arcDmStroke.endDeg - (arcDmStroke.clockwise ? -hitPad : hitPad),
      clockwise: arcDmStroke.clockwise,
    };

    const pathLiverDmVis = svgCircularArc(arcR, arcLiverDm.startDeg, arcLiverDm.endDeg, arcLiverDm.clockwise);
    const pathLiverStrokeVis = svgCircularArc(
      arcR,
      arcLiverStroke.startDeg,
      arcLiverStroke.endDeg,
      arcLiverStroke.clockwise,
    );
    const pathDmStrokeVis = svgCircularArc(arcR, arcDmStroke.startDeg, arcDmStroke.endDeg, arcDmStroke.clockwise);
    const pathLiverDmHit = svgCircularArc(arcR, hitLiverDm.startDeg, hitLiverDm.endDeg, hitLiverDm.clockwise);
    const pathLiverStrokeHit = svgCircularArc(
      arcR,
      hitLiverStroke.startDeg,
      hitLiverStroke.endDeg,
      hitLiverStroke.clockwise,
    );
    const pathDmStrokeHit = svgCircularArc(arcR, hitDmStroke.startDeg, hitDmStroke.endDeg, hitDmStroke.clockwise);

    function arcCenter(startDeg: number, endDeg: number, clockwise: boolean) {
      const mid = arcInterpDeg(startDeg, endDeg, clockwise, 0.5);
      return triangleDegXY(arcR, mid);
    }

    function arcScoreLabel(
      e: EdgeRow,
      startDeg: number,
      endDeg: number,
      clockwise: boolean,
      layoutCx: number,
      layoutCy: number,
    ) {
      const mid = arcInterpDeg(startDeg, endDeg, clockwise, 0.5);
      let { x, y } = triangleDegXY(arcR, mid);
      const rdx = x - layoutCx;
      const rdy = y - layoutCy;
      const rlen = Math.hypot(rdx, rdy) || 1;
      const bump = 20;
      x += (rdx / rlen) * bump;
      y += (rdy / rlen) * bump;
      return { x, y, impact: e.impact, key: e.key };
    }

    /** 说明框锚在弧外侧、贴近弧线，三条边用同一套偏移规则 */
    function edgeNoteAnchor(e: EdgeRow, startDeg: number, endDeg: number, clockwise: boolean, layoutCx: number, layoutCy: number) {
      const mid = arcInterpDeg(startDeg, endDeg, clockwise, 0.48);
      let { x, y } = triangleDegXY(arcR, mid);
      const rdx = x - layoutCx;
      const rdy = y - layoutCy;
      const rlen = Math.hypot(rdx, rdy) || 1;
      const outward = 34;
      x += (rdx / rlen) * outward;
      y += (rdy / rlen) * outward;

      let translateClass = '-translate-x-1/2 -translate-y-1/2';
      if (e.key === 'liver-diabetes') {
        /** 顶边说明框整体下移，避免 -translate-y-full 顶出画布被裁切 */
        translateClass = '-translate-x-1/2 -translate-y-full';
        y += 36;
      } else if (e.key === 'liver-stroke') {
        translateClass = '-translate-x-full -translate-y-1/2';
        x -= 12;
      } else {
        translateClass = 'translate-x-0 -translate-y-1/2';
        x += 12;
      }

      return {
        key: e.key,
        edgeLabel: e.label,
        text: e.clinicalNote,
        impact: e.impact,
        dualLayer: e.dualLayer,
        x,
        y,
        translateClass,
      };
    }

    const scoreLabels = [
      arcScoreLabel(eLiverDm, arcLiverDm.startDeg, arcLiverDm.endDeg, arcLiverDm.clockwise, cx, cy),
      arcScoreLabel(
        eLiverStroke,
        arcLiverStroke.startDeg,
        arcLiverStroke.endDeg,
        arcLiverStroke.clockwise,
        cx,
        cy,
      ),
      arcScoreLabel(eDmStroke, arcDmStroke.startDeg, arcDmStroke.endDeg, arcDmStroke.clockwise, cx, cy),
    ] as const;

    const edgeNotes = [
      edgeNoteAnchor(eLiverDm, arcLiverDm.startDeg, arcLiverDm.endDeg, arcLiverDm.clockwise, cx, cy),
      edgeNoteAnchor(
        eLiverStroke,
        arcLiverStroke.startDeg,
        arcLiverStroke.endDeg,
        arcLiverStroke.clockwise,
        cx,
        cy,
      ),
      edgeNoteAnchor(eDmStroke, arcDmStroke.startDeg, arcDmStroke.endDeg, arcDmStroke.clockwise, cx, cy),
    ] as const;

    return {
      paths: [
        {
          e: eLiverDm,
          dVis: pathLiverDmVis,
          dHit: pathLiverDmHit,
          center: arcCenter(arcLiverDm.startDeg, arcLiverDm.endDeg, arcLiverDm.clockwise),
        },
        {
          e: eLiverStroke,
          dVis: pathLiverStrokeVis,
          dHit: pathLiverStrokeHit,
          center: arcCenter(arcLiverStroke.startDeg, arcLiverStroke.endDeg, arcLiverStroke.clockwise),
        },
        {
          e: eDmStroke,
          dVis: pathDmStrokeVis,
          dHit: pathDmStrokeHit,
          center: arcCenter(arcDmStroke.startDeg, arcDmStroke.endDeg, arcDmStroke.clockwise),
        },
      ] as const,
      scoreLabels,
      edgeNotes,
      nodes: {
        diabetes: triangleDegXY(orbitR, ang.diabetes),
        liver: triangleDegXY(orbitR, ang.liver),
        stroke: triangleDegXY(orbitR, ang.stroke),
      },
    };
  }, [arcR, cx, cy, ang.diabetes, ang.liver, ang.stroke, trimDegHit, eLiverDm, eLiverStroke, eDmStroke, orbitR]);

  const markerSuffix = (k: string) => k.replace(/[^a-zA-Z0-9]/g, '_');

  const activeArcNote = hoverEdgeKey
    ? ringLayout.edgeNotes.find((n) => n.key === hoverEdgeKey) ?? null
    : null;

  return (
    <div
      className="relative mx-auto w-full max-w-[min(97vw,680px)] overflow-visible pt-2"
      style={{ aspectRatio: `${vbW} / ${vbH}`, minHeight: 320 }}
    >
      {/* 底层：参考圆 + 可点击命中区 */}
      <svg
        className="absolute inset-0 z-[8] h-full w-full overflow-visible"
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <circle cx={cx} cy={cy} r={orbitR} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="1" strokeDasharray="5 8" />
        {ringLayout.paths.map(({ e, dHit }) => (
          <path
            key={`hit-${e.key}`}
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
        ))}
      </svg>

      <div className="pointer-events-none absolute inset-0 z-10">
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

      {/* 顶层：可见弧线、箭头与传播分数（置于节点之上，避免箭头被遮挡） */}
      <svg
        className="pointer-events-none absolute inset-0 z-[12] h-full w-full overflow-visible"
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="三病传播关系：三边为同一外接圆上的圆弧，依次为脂肪肝至糖尿病、脂肪肝至脑卒中、糖尿病至脑卒中直接路径"
      >
        <defs>
          <clipPath id={`${uid}_tri_clip`} clipPathUnits="userSpaceOnUse">
            <path fillRule="evenodd" d={triangleNodesClipPathD(ringLayout.nodes, vbW, vbH, PROP_TRIANGLE_NODE_R_VB)} />
          </clipPath>
          {ringLayout.paths.map(({ e }) => {
            const ho = hoverEdgeKey === e.key;
            const st = edgeArrowStyle(ho);
            const mk = markerSuffix(e.key);
            return (
              <React.Fragment key={e.key}>
                <filter
                  id={`${uid}_tri_glow_${mk}`}
                  x="-40%"
                  y="-40%"
                  width="180%"
                  height="180%"
                >
                  <feDropShadow dx="0" dy="1" stdDeviation={ho ? 5 : 2} floodColor={st.stroke} floodOpacity={0.5} />
                </filter>
                <marker
                  id={`${uid}_tri_${mk}`}
                  markerUnits="userSpaceOnUse"
                  markerWidth={ho ? 28 : 24}
                  markerHeight={ho ? 28 : 24}
                  refX={String(PROP_TRIANGLE_MARKER_TIP_LEN)}
                  refY="12"
                  orient="auto"
                  overflow="visible"
                >
                  <path
                    d="M0,3 L0,21 L18,12 Z"
                    fill={st.stroke}
                    stroke="#ffffff"
                    strokeWidth={ho ? 1.2 : 0.35}
                    strokeLinejoin="round"
                  />
                </marker>
              </React.Fragment>
            );
          })}
        </defs>
        <g clipPath={`url(#${uid}_tri_clip)`}>
        {ringLayout.paths.map(({ e, dVis, center }) => {
          const ho = hoverEdgeKey === e.key;
          const v = edgeArrowStyle(ho);
          const baseSw = PROP_TRIANGLE_EDGE_STROKE;
          const activeSw = baseSw + (ho ? 3 : 0);
          const outerBorderSw = activeSw + (ho ? 7 : 0);
          const scale = ho ? 1.04 : 1;
          const { x: pivotX, y: pivotY } = center;
          const edgeTransform =
            ho ? `translate(${pivotX} ${pivotY}) scale(${scale}) translate(${-pivotX} ${-pivotY})` : undefined;
          const mk = markerSuffix(e.key);
          return (
            <g key={e.key} transform={edgeTransform} className="transition-transform duration-200 ease-out">
              {ho ? (
                <>
                  <path
                    d={dVis}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={outerBorderSw}
                    strokeLinecap="butt"
                    strokeLinejoin="round"
                    opacity={0.98}
                  />
                  <path
                    d={dVis}
                    fill="none"
                    stroke={v.stroke}
                    strokeWidth={activeSw + 2.5}
                    strokeLinecap="butt"
                    strokeLinejoin="round"
                    opacity={0.35}
                  />
                </>
              ) : null}
              <path
                d={dVis}
                fill="none"
                stroke={v.stroke}
                strokeWidth={activeSw}
                strokeLinecap="butt"
                strokeLinejoin="round"
                markerEnd={`url(#${uid}_tri_${mk})`}
                opacity={ho ? 1 : 0.92}
                filter={ho ? `url(#${uid}_tri_glow_${mk})` : undefined}
              />
            </g>
          );
        })}
        </g>
        {ringLayout.scoreLabels.map((lab) => {
          const ho = hoverEdgeKey === lab.key;
          const v = edgeArrowStyle(ho);
          const label = `${lab.impact}%`;
          const fw = label.length * 7.8 + 22;
          const fh = 28;
          const scale = ho ? 1.14 : 1;
          const labelTransform = ho
            ? `translate(${lab.x} ${lab.y}) scale(${scale}) translate(${-lab.x} ${-lab.y})`
            : undefined;
          return (
            <g
              key={`score-${lab.key}`}
              transform={labelTransform}
              opacity={ho ? 1 : 0.96}
              className="transition-transform duration-200 ease-out"
            >
              {ho ? (
                <rect
                  x={lab.x - fw / 2 - 3}
                  y={lab.y - fh / 2 - 3}
                  width={fw + 6}
                  height={fh + 6}
                  rx={10}
                  fill="none"
                  stroke={v.stroke}
                  strokeWidth={2}
                  opacity={0.55}
                />
              ) : null}
              <rect
                x={lab.x - fw / 2}
                y={lab.y - fh / 2}
                width={fw}
                height={fh}
                rx={8}
                fill="white"
                fillOpacity={0.98}
                stroke={v.stroke}
                strokeWidth={ho ? 2.5 : 1}
              />
              <text
                x={lab.x}
                y={lab.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={v.stroke}
                fontSize={ho ? 17 : 16}
                fontWeight={700}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 悬停弧线时仅显示一条说明（避免与上方横向 ArrowSegment 重复） */}
      <div className="pointer-events-none absolute inset-0 z-[13]">
        {activeArcNote ? (
          <PropagationArcCallout
            edgeKey={activeArcNote.key}
            edgeLabel={activeArcNote.edgeLabel}
            text={activeArcNote.text}
            dualLayer={activeArcNote.dualLayer}
            accentStroke={edgeArrowStyle(true).stroke}
            translateClass={activeArcNote.translateClass}
            style={{
              left: `${(activeArcNote.x / vbW) * 100}%`,
              top: `${(activeArcNote.y / vbH) * 100}%`,
            }}
            onHoverEdge={onHoverEdge}
          />
        ) : null}
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
  const v = edgeArrowStyle(hovered);
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
          <p className={cn('text-base font-bold leading-snug text-gray-900', textSide === 'right' && 'text-right')}>
            <span className="tabular-nums font-extrabold text-gray-950">{edge.impact}%</span>
            <span className="mx-1.5 text-gray-400">·</span>
            <span>{cap}</span>
            {edge.key === 'diabetes-stroke' ? (
              <span className="ml-1.5 align-middle text-xs font-semibold text-amber-800">直接</span>
            ) : null}
          </p>
          <p
            className={cn(
              'mt-2 text-sm leading-relaxed text-gray-600',
              textSide === 'right' && 'text-right',
            )}
          >
            {edge.summaryZh}
          </p>
          <p
            className={cn(
              'mt-2.5 border-t border-gray-100 pt-2 text-xs leading-snug text-gray-500',
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

  const eLiverDm = edgeByKey['liver-diabetes'];
  const eLiverStroke = edgeByKey['liver-stroke'];
  const eDmStroke = edgeByKey['diabetes-stroke'];

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <div className="relative overflow-visible rounded-2xl border border-gray-200 bg-white px-3 py-6 shadow-sm ring-1 ring-gray-100 sm:px-5 sm:py-8">
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative z-[1] mx-auto flex max-w-5xl flex-col items-center overflow-visible px-1 pb-1 pt-4 sm:px-2">
          {eLiverDm && eLiverStroke && eDmStroke ? (
            <PropagationDiseaseTriangleFlow
              uid={uid}
              eLiverDm={eLiverDm}
              eLiverStroke={eLiverStroke}
              eDmStroke={eDmStroke}
              hoverEdgeKey={hoverEdgeKey}
              onHoverEdge={onHoverEdge}
              onSelectTarget={onSelectTarget}
            />
          ) : null}
          <p className="mt-4 max-w-md text-center text-xs leading-relaxed text-gray-500">
            三边为同一外接圆上的圆弧，合围成环：脂肪肝→糖尿病→脑卒中，以及糖尿病→脑卒中直接路径；箭头默认绿色，悬停时高亮为黄色。
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
    from: 'liver',
    to: 'diabetes',
    pathWeight: 0.92,
    clinicalNote:
      '胰岛素抵抗与肝脂沉积可相互促进：脂肪肝常伴随糖代谢异常，加重糖尿病发生与进展风险。',
    summaryZh:
      '肝脂沉积与胰岛素抵抗相互强化，脂肪肝可推动糖代谢恶化；宜同步关注护肝与控糖，打断彼此加重。',
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
  showHoverCallout = true,
}: {
  edge: EdgeRow;
  onSelectTarget: (id: PropagationDiseaseId) => void;
  onHoverKey: (key: string | null) => void;
  hoverEdgeKey: string | null;
  compact?: boolean;
  /** analytics：深色大屏风格；paper：原有浅灰卡片 */
  vizSurface?: 'paper' | 'analytics';
  /** 完整页三角图已有弧线旁说明时，横向条不再弹出第二块浮层 */
  showHoverCallout?: boolean;
}) {
  const hovered = hoverEdgeKey === edge.key;
  const v = edgeArrowStyle(hovered);
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
            ? 'bg-gray-50 ring-1 ring-yellow-200/80'
            : 'hover:bg-gray-50/80',
      )}
    >
      <p
        className={cn(
          'order-1 text-center font-semibold tabular-nums',
          compact ? 'text-sm sm:text-base' : 'text-base',
          dark ? 'text-slate-200' : 'text-gray-600',
        )}
      >
        ΔRisk&nbsp;
        <span className="font-mono">{edge.impact}</span>%
      </p>
      <div className="order-2 flex w-full max-w-[8rem] items-center justify-center sm:max-w-none">
        {dark ? (
          <FlowChannel edgeKey={edge.key} hovered={hovered} />
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
          dark ? edgeLabelOnDark(hovered) : v.labelClass,
        )}
      >
        {edge.label}
      </p>
      {showHoverCallout && hovered ? (
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-[min(18rem,calc(100vw-4rem))] -translate-x-1/2 rounded-xl border border-gray-200 p-2.5 text-left text-sm leading-relaxed shadow-md ring-1 ring-gray-100/90',
            dark
              ? 'border-teal-500/25 bg-slate-900/95 text-slate-200 ring-white/10 backdrop-blur-md'
              : 'bg-white text-gray-700',
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
  propagationDetail?: RiskPredictResponse['propagationDetail'];
  selectedId: PropagationDiseaseId;
  onSelectDisease: (id: PropagationDiseaseId) => void;
  className?: string;
  /** 首页等场景的简要布局：三病三角顶点 + 三边箭头，无「直接补充」横条 */
  compact?: boolean;
}

export function DiseaseRiskPropagationModule({
  diseases,
  propagationScores,
  propagationDetail,
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
        e.from === 'liver' && e.to === 'diabetes'
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
        e.from === 'liver' && e.to === 'diabetes'
          ? '脂肪肝→糖尿病'
          : e.from === 'liver' && e.to === 'stroke'
            ? '脂肪肝→脑卒中'
            : e.from === 'diabetes' && e.to === 'stroke'
              ? '糖尿病→脑卒中'
              : `${from.shortName}→${to.shortName}`;
      const detailKey = `${e.from}-${e.to}` as 'liver-diabetes' | 'liver-stroke' | 'diabetes-stroke';
      return {
        key: detailKey,
        from,
        to,
        impact,
        label,
        clinicalNote: e.clinicalNote,
        summaryZh: e.summaryZh,
        dualLayer: propagationDetail?.[detailKey],
      };
    });
  }, [liver, dm, stroke, propagationScores, propagationDetail]);

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
              isCompact ? 'text-sm' : 'text-sm',
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
              isCompact ? 'py-0.5 text-sm' : 'py-0.5 text-xs',
              analyticsCard ? riskPill(d.risk) : riskPill(d.risk),
            )}
          >
            {d.riskLabel}
          </span>
          <p
            className={cn(
              'mt-1 line-clamp-2',
              isCompact ? 'text-xs leading-tight' : 'text-xs',
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
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
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
                  {[eLiverDm, eLiverStroke, eDmStroke].flatMap((ed) =>
                    ([false, true] as const).map((ho) => {
                      const st = edgeArrowStyle(ho);
                      return (
                        <marker
                          key={`${ed.key}-${ho ? 'h' : 'n'}`}
                          id={`${arrowMarkerId}-${ed.key}-${ho ? 'h' : 'n'}`}
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
                    }),
                  )}
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
                        60,
                        68,
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
                        60,
                        70,
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
                        60,
                        70,
                      ),
                      lx: -16,
                      ly: -12,
                    },
                  ] as const
                ).map(({ e, x1, y1, x2, y2, lx, ly }) => {
                  const ho = hoverEdgeKey === e.key;
                  const v = edgeArrowStyle(ho);
                  const mx = (x1 + x2) / 2 + lx;
                  const my = (y1 + y2) / 2 + ly;
                  const pivotX = (x1 + x2) / 2;
                  const pivotY = (y1 + y2) / 2;
                  const activeSw = PROPAGATION_EDGE_STROKE + (ho ? 2.5 : 0);
                  const edgeTransform = ho
                    ? `translate(${pivotX} ${pivotY}) scale(1.04) translate(${-pivotX} ${-pivotY})`
                    : undefined;
                  return (
                    <g key={e.key} transform={edgeTransform} className="transition-transform duration-200 ease-out">
                      {ho ? (
                        <>
                          <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke="#ffffff"
                            strokeWidth={activeSw + 6}
                            strokeLinecap="round"
                            className="pointer-events-none"
                          />
                          <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={v.stroke}
                            strokeWidth={activeSw + 2}
                            strokeLinecap="round"
                            opacity={0.35}
                            className="pointer-events-none"
                          />
                        </>
                      ) : null}
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={v.stroke}
                        strokeWidth={activeSw}
                        strokeLinecap="round"
                        markerEnd={`url(#${arrowMarkerId}-${e.key}-${ho ? 'h' : 'n'})`}
                        opacity={ho ? 1 : 0.95}
                        className="pointer-events-none"
                      />
                      <text
                        x={mx}
                        y={my}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#4b5563"
                        fontSize={11}
                        fontWeight={600}
                        className="pointer-events-none select-none"
                      >
                        {`${e.impact}%`}
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
              <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-base leading-relaxed text-gray-700 shadow-sm">
                <p>{edgeMap[hoverEdgeKey]?.clinicalNote ?? ''}</p>
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
                showHoverCallout={false}
              />
              <NodeButton d={dm} />
              <ArrowSegment
                edge={eLiverStroke}
                onSelectTarget={onSelectDisease}
                onHoverKey={setHoverEdgeKey}
                hoverEdgeKey={hoverEdgeKey}
                compact={false}
                vizSurface="paper"
                showHoverCallout={false}
              />
              <NodeButton d={stroke} />
            </div>

            <PropagationIntensityComparison
              edges={[eLiverDm, eLiverStroke, eDmStroke]}
              hoverEdgeKey={hoverEdgeKey}
              onHoverEdge={setHoverEdgeKey}
              onSelectTarget={onSelectDisease}
            />

          </div>
        )}
      </div>
    </section>
  );
}
