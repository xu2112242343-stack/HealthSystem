import React, { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  ChevronRight,
  Droplet,
  Info,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { LiverIcon } from '../components/icons/LiverIcon';
import { DiseaseRiskPropagationModule } from '../components/risk/DiseaseRiskPropagationModule';
import { cn } from '../components/ui/utils';
import { fetchRiskPredict, type RiskPredictResponse } from '@/lib/api/riskPredict';
import { fetchUserQuestionnaireFromServer } from '@/lib/api/userQuestionnaire';
import { mergeRiskIntoDiseases } from '@/app/utils/mergeRiskPredict';
import { QUESTIONNAIRE_UPDATED_EVENT } from '@/lib/questionnaireSnapshot';
import { riskAverageToHealthComposite } from '@/lib/riskScoreDisplay';
import { useStoredAccessToken } from '@/lib/useStoredAccessToken';
import type { BasicState, IndicatorsState, LifestyleState } from '@/lib/types/questionnaireForm';

type RiskLevel = 'low' | 'medium' | 'high';

type FactorStatus = 'normal' | 'warning' | 'danger';

type DiseaseId = 'liver' | 'diabetes' | 'stroke';

interface KeyFactor {
  name: string;
  current: string;
  reference: string;
  status: FactorStatus;
  /** 0–100 用于展示「风险贡献度」条形，非临床绝对值 */
  contribution: number;
  modality: '问卷' | '检验' | '影像';
}

interface DiseaseModel {
  id: DiseaseId;
  shortName: string;
  fullName: string;
  subtitle: string;
  risk: RiskLevel;
  riskLabel: string;
  probability: number | null;
  score: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'emerald' | 'red' | 'amber';
  summary: string;
  keyFactors: KeyFactor[];
  drivers: string[];
  actions: string[];
  trendData: Record<string, string | number>[];
  trendNote: string;
  trendDirection: 'up' | 'down' | 'flat';
}

type QuestionnaireSnapshot = {
  basic: BasicState;
  lifestyle: LifestyleState;
  indicators: IndicatorsState;
  derived: Record<string, string>;
};

type QuestionnairePath = `basic.${string}` | `lifestyle.${string}` | `indicators.${string}` | `derived.${string}`;

const COMPLETENESS_FEATURES: Record<DiseaseId, readonly QuestionnairePath[]> = {
  stroke: [
    'indicators.ldh',
    'indicators.chloride',
    'indicators.serumIron',
    'indicators.ldl',
    'indicators.bun',
    'indicators.hematocrit',
    'indicators.rbc',
    'indicators.rdw',
    'indicators.hemoglobin',
    'indicators.lymphocytePct',
    'derived.map',
  ],
  diabetes: [
    'basic.symptomPolyuria',
    'basic.symptomWeightLoss',
    'basic.symptomThirst',
    'basic.symptomBlurVision',
    'basic.antihypertensiveDrugs',
    'basic.hypoglycemicDrugs',
    'basic.gestationalDiabetes',
    'lifestyle.scaleHealthKnowledge',
    'basic.prediabetes',
    'lifestyle.scaleQualityOfLife',
    'lifestyle.scaleFatigue',
    'lifestyle.scaleDietQuality',
    'indicators.bun',
    'basic.familyHistoryDiabetes',
    'basic.symptomSlowHealing',
    'basic.pcos',
  ],
  liver: [
    'indicators.alt',
    'indicators.ggt',
    'indicators.totalBilirubin',
    'indicators.albumin',
    'indicators.hba1c',
    'indicators.uricAcid',
    'indicators.tg',
    'derived.altAst',
    'derived.tcHdl',
    'derived.bri',
  ],
};

function getPathValue(snapshot: QuestionnaireSnapshot | null, path: QuestionnairePath): string {
  if (!snapshot) return '';
  const [group, key] = path.split('.') as ['basic' | 'lifestyle' | 'indicators' | 'derived', string];
  const bucket = snapshot[group] as Record<string, string>;
  return String(bucket[key] ?? '').trim();
}

function computeInfoCompletenessByDisease(
  diseaseId: DiseaseId,
  snapshot: QuestionnaireSnapshot | null,
): number {
  const features = COMPLETENESS_FEATURES[diseaseId];
  if (!features || features.length === 0) return 0;
  const filled = features.reduce((sum, path) => (getPathValue(snapshot, path) ? sum + 1 : sum), 0);
  return Math.round((filled / features.length) * 100);
}

function completenessStyle(score: number) {
  if (score >= 80) return { text: 'text-emerald-700', bar: 'bg-emerald-500' };
  if (score >= 50) return { text: 'text-amber-700', bar: 'bg-amber-500' };
  return { text: 'text-rose-700', bar: 'bg-rose-500' };
}

/** 无后端结果时的空壳；有 remoteRisk 时由 mergeRiskIntoDiseases 覆盖分数与因子 */
const EMPTY_DISEASES_BASE: DiseaseModel[] = [
  {
    id: 'liver',
    shortName: 'MAFLD',
    fullName: '肝病',
    subtitle: '—',
    risk: 'low',
    riskLabel: '暂无',
    probability: null,
    score: 0,
    icon: LiverIcon,
    accent: 'emerald',
    summary: '暂无模型评估数据。请完善问卷并确保可访问后端风险评估接口。',
    keyFactors: [],
    drivers: [],
    actions: [],
    trendData: [],
    trendNote: '暂无趋势数据。',
    trendDirection: 'flat',
  },
  {
    id: 'diabetes',
    shortName: 'T2DM',
    fullName: '糖尿病',
    subtitle: '—',
    risk: 'low',
    riskLabel: '暂无',
    probability: null,
    score: 0,
    icon: Droplet,
    accent: 'red',
    summary: '暂无模型评估数据。请完善问卷并确保可访问后端风险评估接口。',
    keyFactors: [],
    drivers: [],
    actions: [],
    trendData: [],
    trendNote: '暂无趋势数据。',
    trendDirection: 'flat',
  },
  {
    id: 'stroke',
    shortName: 'CVA',
    fullName: '脑卒中',
    subtitle: '—',
    risk: 'low',
    riskLabel: '暂无',
    probability: null,
    score: 0,
    icon: Brain,
    accent: 'amber',
    summary: '暂无模型评估数据。请完善问卷并确保可访问后端风险评估接口。',
    keyFactors: [],
    drivers: [],
    actions: [],
    trendData: [],
    trendNote: '暂无趋势数据。',
    trendDirection: 'flat',
  },
];

function statusStyles(s: FactorStatus) {
  switch (s) {
    case 'danger':
      return {
        bar: 'from-rose-500 to-red-600',
        badge: 'bg-rose-100 text-rose-800 border border-rose-200',
        dot: 'bg-rose-500',
      };
    case 'warning':
      return {
        bar: 'from-amber-400 to-orange-500',
        badge: 'bg-amber-50 text-amber-900 border border-amber-200',
        dot: 'bg-amber-500',
      };
    default:
      return {
        bar: 'from-emerald-400 to-teal-600',
        badge: 'bg-emerald-50 text-emerald-900 border border-emerald-200',
        dot: 'bg-emerald-500',
      };
  }
}

function solidStatusTrack(s: FactorStatus): string {
  switch (s) {
    case 'danger':
      return 'bg-rose-100';
    case 'warning':
      return 'bg-amber-100';
    default:
      return 'bg-emerald-100';
  }
}

function solidStatusBg(s: FactorStatus): string {
  switch (s) {
    case 'danger':
      return 'bg-rose-500';
    case 'warning':
      return 'bg-amber-500';
    default:
      return 'bg-emerald-500';
  }
}

const STATUS_VERTEX: Record<FactorStatus, string> = {
  danger: '#f43f5e',
  warning: '#f59e0b',
  normal: '#10b981',
};

function CoreFactorsVisualization({ factors }: { factors: KeyFactor[] }) {
  const sorted = useMemo(
    () => [...factors].sort((a, b) => b.contribution - a.contribution),
    [factors],
  );

  const shareSum = useMemo(
    () => sorted.reduce((s, f) => s + Math.max(0, f.contribution), 0) || 1,
    [sorted],
  );

  if (sorted.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-10 text-center text-sm text-gray-500">
        暂无核心因素分解数据。
      </p>
    );
  }

  const n = sorted.length;
  const showRadar = n >= 3;
  const cx = 130;
  const cy = 130;
  const maxR = 88;

  const unitRing = (scale: number) => {
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n - Math.PI / 2;
      const r = maxR * scale;
      pts.push(`${cx + r * Math.cos(t)},${cy + r * Math.sin(t)}`);
    }
    return pts.join(' ');
  };

  const dataPoints = sorted.map((f, i) => {
    const c = Math.max(0, Math.min(100, f.contribution));
    const t = (2 * Math.PI * i) / n - Math.PI / 2;
    const r = maxR * (0.12 + (c / 100) * 0.88);
    return {
      x: cx + r * Math.cos(t),
      y: cy + r * Math.sin(t),
      status: f.status,
    };
  });

  const dataPoly = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ring-1 ring-gray-100/80">
      <div className="border-b border-gray-100 bg-gradient-to-br from-slate-50/90 via-white to-emerald-50/20 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">构成占比</p>
          </div>
        </div>
        <div
          className="mt-3 flex h-3.5 w-full overflow-hidden border border-gray-300/60 bg-white shadow-inner"
          title="各因子相对权重"
        >
          {sorted.map((f) => {
            const w = (Math.max(0, f.contribution) / shareSum) * 100;
            return (
              <div
                key={`seg-${f.name}`}
                className={cn('h-full min-w-px', solidStatusBg(f.status))}
                style={{ width: `${w}%` }}
                title={`${f.name} · ${f.contribution}%`}
              />
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 bg-rose-500" aria-hidden />
            高影响
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 bg-amber-500" aria-hidden />
            需关注
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 bg-emerald-500" aria-hidden />
            影响较低
          </span>
        </div>
      </div>

      <div
        className={cn(
          'grid gap-6 p-4 sm:p-5',
          showRadar ? 'lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]' : '',
        )}
      >
        {showRadar ? (
          <div className="flex flex-col items-center lg:items-start">
            <p className="mb-2 w-full text-center text-sm font-semibold text-gray-500 lg:text-left">
              贡献轮廓
            </p>
            <svg
              viewBox="0 0 260 260"
              className="h-auto w-full max-w-[260px] shrink-0"
              role="img"
              aria-label="核心因素贡献轮廓示意"
              shapeRendering="geometricPrecision"
            >
              {[0.34, 0.67, 1].map((scale, gi) => (
                <polygon
                  key={gi}
                  points={unitRing(scale)}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
              ))}
              <polygon
                points={dataPoly}
                fill="rgba(16, 185, 129, 0.12)"
                stroke="#0f7668"
                strokeWidth={2}
                strokeLinejoin="miter"
              />
              {dataPoints.map((p, i) => (
                <circle
                  key={`v-${sorted[i].name}`}
                  cx={p.x}
                  cy={p.y}
                  r={5}
                  fill={STATUS_VERTEX[p.status]}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
              ))}
              {sorted.map((f, i) => {
                const t = (2 * Math.PI * i) / n - Math.PI / 2;
                const lx = cx + (maxR + 20) * Math.cos(t);
                const ly = cy + (maxR + 20) * Math.sin(t);
                return (
                  <text
                    key={`ix-${f.name}`}
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#64748b"
                    style={{ fontSize: '12px', fontWeight: 700 }}
                  >
                    {i + 1}
                  </text>
                );
              })}
            </svg>
          </div>
        ) : null}

        <div className="min-w-0 space-y-3">
          <p
            className={cn(
              'text-sm font-semibold text-gray-500',
              showRadar ? 'lg:pt-0' : 'pt-0',
            )}
          >
            因子明细
          </p>
          {sorted.map((f, rank) => {
            const st = statusStyles(f.status);
            const contribution = Math.max(0, Math.min(100, f.contribution));
            return (
              <div
                key={f.name}
                className="rounded-xl border border-gray-100 bg-gradient-to-br from-white to-slate-50/50 p-4 ring-1 ring-gray-100/70"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-gray-200 bg-white font-mono text-sm font-bold text-gray-800 tabular-nums shadow-sm">
                      {rank + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('inline-block h-2.5 w-2.5 shrink-0', st.dot)} />
                        <span className="text-base font-semibold text-gray-900">{f.name}</span>
                        <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {f.modality}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-md border px-3 py-1.5 text-sm font-semibold tabular-nums',
                      st.badge,
                    )}
                  >
                    {f.current}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className={cn(
                      'h-2.5 min-h-0 flex-1 overflow-hidden',
                      solidStatusTrack(f.status),
                    )}
                  >
                    <div
                      className={cn('h-full bg-gradient-to-r rounded-none', st.bar)}
                      style={{ width: `${contribution}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-sm font-bold tabular-nums text-gray-800">
                    {contribution}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function accentIconWrap(accent: DiseaseModel['accent']) {
  switch (accent) {
    case 'red':
      return 'from-rose-500 to-red-600 shadow-red-500/25';
    case 'amber':
      return 'from-amber-500 to-orange-600 shadow-amber-500/25';
    default:
      return 'from-emerald-500 to-teal-600 shadow-emerald-500/25';
  }
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

function cardBorder(selected: boolean, risk: RiskLevel) {
  if (!selected) {
    return 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm';
  }
  switch (risk) {
    case 'high':
      return 'border-rose-400 bg-gradient-to-br from-rose-50/80 to-white shadow-md ring-2 ring-rose-200/80';
    case 'medium':
      return 'border-amber-400 bg-gradient-to-br from-amber-50/80 to-white shadow-md ring-2 ring-amber-200/80';
    default:
      return 'border-emerald-400 bg-gradient-to-br from-emerald-50/80 to-white shadow-md ring-2 ring-emerald-200/80';
  }
}

/** 健康综合分（越高越安全）→ 风险等级文案 */
function compositeHealthLevel(healthComposite: number | null) {
  if (healthComposite === null) {
    return {
      label: '暂无',
      className: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    };
  }
  if (healthComposite >= 85) {
    return {
      label: '低风险',
      className: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
    };
  }
  if (healthComposite >= 70) {
    return {
      label: '较低风险',
      className: 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200',
    };
  }
  if (healthComposite >= 55) {
    return {
      label: '中等风险',
      className: 'bg-amber-50 text-amber-950 ring-1 ring-amber-200',
    };
  }
  if (healthComposite >= 40) {
    return {
      label: '较高风险',
      className: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
    };
  }
  return {
    label: '高风险',
    className: 'bg-rose-100 text-rose-800 ring-1 ring-rose-200',
  };
}

export function RiskAssessment() {
  const accessToken = useStoredAccessToken();
  const [selectedId, setSelectedId] = useState<DiseaseModel['id']>('liver');
  const [remoteRisk, setRemoteRisk] = useState<RiskPredictResponse | null>(null);
  const [questionnaireSnapshot, setQuestionnaireSnapshot] = useState<QuestionnaireSnapshot | null>(null);
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskError, setRiskError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setRiskLoading(true);
      Promise.all([fetchRiskPredict(), fetchUserQuestionnaireFromServer()])
        .then(([riskRes, questionnaireRes]) => {
          if (cancelled) return;
          setRemoteRisk(riskRes);
          setQuestionnaireSnapshot(questionnaireRes);
          setRiskError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setRiskError(e instanceof Error ? e.message : '加载失败');
        })
        .finally(() => {
          if (!cancelled) setRiskLoading(false);
        });
    };
    load();
    window.addEventListener(QUESTIONNAIRE_UPDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(QUESTIONNAIRE_UPDATED_EVENT, load);
    };
  }, [accessToken]);

  const diseasesEffective = useMemo(
    () =>
      remoteRisk ? mergeRiskIntoDiseases(EMPTY_DISEASES_BASE, remoteRisk) : EMPTY_DISEASES_BASE,
    [remoteRisk],
  );

  const selected = useMemo(
    () => diseasesEffective.find((d) => d.id === selectedId) ?? diseasesEffective[0],
    [diseasesEffective, selectedId],
  );

  const radarRows = useMemo(
    () =>
      diseasesEffective.map((d) => ({
        axis: d.shortName,
        full: d.fullName,
        value: d.score,
      })),
    [diseasesEffective],
  );

  const composite = useMemo(
    () => riskAverageToHealthComposite(remoteRisk?.compositeIndex),
    [remoteRisk],
  );

  const TrendIcon =
    selected.trendDirection === 'up'
      ? TrendingUp
      : selected.trendDirection === 'down'
        ? TrendingDown
        : Minus;

  const trendIconClass =
    selected.trendDirection === 'up'
      ? 'text-rose-600'
      : selected.trendDirection === 'down'
        ? 'text-emerald-600'
        : 'text-amber-600';

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/80 p-4 sm:p-6">
      {/* 页头：产品叙事 */}
      <header className="relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-6 sm:p-8 shadow-sm mb-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-emerald-200/50 to-teal-200/30 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-violet-200/30 blur-2xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200/80">
              <Sparkles className="h-3.5 w-3.5" />
              多模态 · MAFLD / T2DM / CVA
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              风险评估
            </h1>
            <p className="text-sm leading-relaxed text-gray-600">
              融合问卷、检验与影像等数据，对三条疾病轴分别打分并汇总展示。
            </p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <Info className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              {remoteRisk ? '以下为模型估算结果，不替代诊疗。' : '尚无评估结果时将显示占位，不替代诊疗。'}
              {riskLoading && <span className="text-gray-400">同步中…</span>}
              {riskError && <span className="text-rose-600">（{riskError}）</span>}
            </p>
          </div>

          <div className="w-full shrink-0 rounded-2xl border border-gray-100 bg-gray-50/80 p-5 lg:w-72">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">综合指数</p>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-4xl font-bold tabular-nums text-gray-900">
                    {composite !== null ? composite : '—'}
                  </span>
                  {composite !== null ? (
                    <span className="pb-1 text-sm text-gray-500">/ 100</span>
                  ) : null}
                </div>
              </div>
              <span
                className={`mt-1 rounded-full px-2.5 py-1 text-xs font-semibold ${compositeHealthLevel(composite).className}`}
              >
                {compositeHealthLevel(composite).label}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500"
                style={{ width: `${composite !== null ? Math.min(100, composite) : 0}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-gray-600">
              为三病风险均值换算的健康综合分：分数越高表示相对风险越低（100 − 风险均值）。
            </p>
          </div>
        </div>
      </header>

      <DiseaseRiskPropagationModule
        diseases={diseasesEffective}
        propagationScores={remoteRisk?.propagationScores}
        propagationDetail={remoteRisk?.propagationDetail}
        selectedId={selectedId}
        onSelectDisease={setSelectedId}
        className="mb-6"
      />

      {/* 三病卡片（上） + 详情（下） */}
      <div className="flex flex-col gap-6">
        <div className="space-y-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 px-1">
            点选病种（下方联动详情）
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {diseasesEffective.map((d) => {
              const Icon = d.icon;
              const sel = selectedId === d.id;
              const completeness = computeInfoCompletenessByDisease(d.id, questionnaireSnapshot);
              const compStyle = completenessStyle(completeness);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={cn(
                    'flex min-h-[190px] flex-col rounded-2xl border p-4 text-left transition-all',
                    cardBorder(sel, d.risk),
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={cn(
                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg',
                        accentIconWrap(d.accent),
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={2} />
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold',
                        riskPill(d.risk),
                      )}
                    >
                      {d.riskLabel}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                    {d.shortName}
                  </p>
                  <h3 className="mt-0.5 text-base font-bold leading-snug text-gray-900">
                    {d.fullName}
                  </h3>
                  <p className="mt-1 text-xs text-gray-500 line-clamp-2">{d.subtitle}</p>
                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-500">信息完整度</span>
                      <span className={cn('text-sm font-semibold', compStyle.text)}>
                        {completeness}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={cn('h-full rounded-full', compStyle.bar)}
                        style={{ width: `${completeness}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-auto flex w-full items-center justify-end gap-2 border-t border-gray-100 pt-2">
                    <span
                      className={cn(
                        'leading-none text-xs font-medium',
                        sel ? 'text-emerald-700' : 'text-gray-400',
                      )}
                    >
                      查看详情
                    </span>
                    <ChevronRight
                      className={cn(
                        'h-5 w-5 shrink-0 transition-transform',
                        sel ? 'translate-x-0.5 text-emerald-600' : 'text-gray-300',
                      )}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 下方详情：概览与关键因子表 */}
        <div className="w-full space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                当前查看 · 与上方选中一致
              </span>
              <span className="hidden sm:inline">点击上方卡片可切换</span>
            </div>
            <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 sm:flex-row sm:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const SelIcon = selected.icon;
                    return (
                      <span
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-md',
                          accentIconWrap(selected.accent),
                        )}
                      >
                        <SelIcon className="h-4 w-4" strokeWidth={2} />
                      </span>
                    );
                  })()}
                  <h2 className="text-xl font-bold text-gray-900">{selected.fullName}</h2>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      riskPill(selected.risk),
                    )}
                  >
                    {selected.riskLabel}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{selected.summary}</p>
              </div>
            </div>

            {/* 关键因子：构成条 + 雷达轮廓 + 明细卡片 */}
            <div className="mt-6">
              <h3 className="text-base font-semibold text-gray-900">影响您健康的核心因素</h3>
              <div className="mt-4">
                <CoreFactorsVisualization factors={selected.keyFactors} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
