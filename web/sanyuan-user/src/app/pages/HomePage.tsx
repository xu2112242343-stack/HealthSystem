import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  Activity,
  Heart,
  Brain,
  Droplet,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  User,
  Calculator,
  Upload,
  Loader2,
  Sparkles,
  Stethoscope,
} from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import { LiverIcon } from '@/app/components/icons/LiverIcon';
import {
  DiseaseRiskPropagationModule,
  type PropagationDiseaseId,
  type PropagationDiseaseModel,
} from '@/app/components/risk/DiseaseRiskPropagationModule';
import { fetchRiskPredict, type RiskPredictResponse } from '@/lib/api/riskPredict';
import {
  getRiskPredictRequestBody,
  QUESTIONNAIRE_UPDATED_EVENT,
} from '@/lib/questionnaireSnapshot';
import { readQuestionnaireCompletion } from '@/lib/questionnaireCompletion';
import { riskAverageToHealthComposite } from '@/lib/riskScoreDisplay';
import { useStoredAccessToken } from '@/lib/useStoredAccessToken';
import { fetchUserAxisImageMeta } from '@/lib/api/userImages';

/** 后端 `topFactors[].value` 为 0~1 的相对权重；玫瑰图按百分比展示。若将来传入已为 0~100 则不再乘。 */
function factorWeightToRosePercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const scaled = raw <= 1 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, Math.round(scaled)));
}

/** 首页玫瑰图等展示用：去掉中英文括号内的单位说明，如「甘油三酯 (mmol/L, SI)」→「甘油三酯」。 */
function factorNameForDisplay(raw: string): string {
  return raw
    .replace(/\s*[\(（][^)）]*[\)）]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type HealthScoreAccent = 'emerald' | 'blue' | 'orange' | 'slate' | 'red';

/** 外环：临床常用分档色，略压低饱和度以贴近信息系统 */
const HEALTH_SCORE_RING_GRADIENT: Record<HealthScoreAccent, { hi: string; lo: string }> = {
  emerald: { hi: '#5eead4', lo: '#0f7669' },
  blue: { hi: '#7dd3fc', lo: '#0369a1' },
  orange: { hi: '#fcd34d', lo: '#b45309' },
  slate: { hi: '#cbd5e1', lo: '#64748b' },
  red: { hi: '#fca5a5', lo: '#991b1b' },
};

/** 成人正面剪影：连续曲线、肩—腰—髋比例接近常规模型示意 */
const HEALTH_SCORE_HUMAN_SILHOUETTE_PATH =
  'M 130 30 C 156 30 174 48 174 74 C 174 90 166 100 154 105 L 149 112 ' +
  'C 182 120 202 142 208 174 C 212 198 204 214 186 220 L 190 242 ' +
  'C 196 290 188 322 172 338 L 150 342 L 130 312 L 110 342 L 88 338 ' +
  'C 72 322 64 290 70 242 L 74 220 C 56 214 48 198 52 174 C 58 142 78 120 111 112 ' +
  'L 106 105 C 94 100 86 90 86 74 C 86 48 104 30 130 30 Z';

function HealthCompositeScoreGraphic({
  score,
  accent,
}: {
  score: number | null;
  accent: HealthScoreAccent;
}) {
  const uid = useId().replace(/:/g, '');
  const cx = 130;
  const cy = 186;
  const r = 108;
  const sw = 5;
  const circumference = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  const dashOffset = score === null ? circumference : circumference * (1 - pct / 100);
  const ringG = HEALTH_SCORE_RING_GRADIENT[accent];

  return (
    <div
      className="mx-auto w-full max-w-[min(300px,100%)] rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm ring-1 ring-slate-100/90"
      role="img"
      aria-label={
        score === null
          ? '综合健康评分：待评估；正面人体为健康宣教用示意图'
          : `综合健康评分：${score} 分；外环为模型相对指数，人体为宣教示意图`
      }
    >
      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-[#f5f9fc] shadow-sm ring-1 ring-slate-200/50">
        <div className="border-b border-slate-200/80 bg-white/90 px-3 py-2">
          <p className="text-[11px] font-semibold tracking-wide text-slate-700">健康综合指数 · 示意模型</p>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-500">仅供健康教育与风险评估参考，非诊断依据</p>
        </div>
        <div className="relative overflow-hidden px-1 pb-1 pt-2">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_68%_52%_at_50%_40%,rgba(255,255,255,0.9),transparent_62%)]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_42%_at_50%_36%,rgba(14,165,233,0.05),transparent_55%)]"
            aria-hidden
          />
          <svg
            viewBox="0 0 260 348"
            className="relative z-[1] mx-auto block h-auto w-full max-h-[min(380px,52vh)]"
            shapeRendering="geometricPrecision"
            aria-hidden
          >
          <defs>
            <linearGradient id={`${uid}_body`} x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#e2edf5" />
              <stop offset="32%" stopColor="#cddce8" />
              <stop offset="68%" stopColor="#a8bac9" />
              <stop offset="100%" stopColor="#7d8fa3" />
            </linearGradient>
            <linearGradient id={`${uid}_ring`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={ringG.hi} stopOpacity={0.9} />
              <stop offset="100%" stopColor={ringG.lo} stopOpacity={0.94} />
            </linearGradient>
            <filter id={`${uid}_soft`} x="-25%" y="-20%" width="150%" height="145%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.8" floodColor="#475569" floodOpacity="0.12" />
            </filter>
          </defs>

          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#c9dae6"
            strokeWidth={sw}
            strokeLinecap="butt"
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={`url(#${uid}_ring)`}
            strokeWidth={sw}
            strokeLinecap="butt"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            className="transition-[stroke-dashoffset] duration-[900ms] ease-out"
            opacity={score === null ? 0 : 1}
          />

          <path
            d={HEALTH_SCORE_HUMAN_SILHOUETTE_PATH}
            fill={`url(#${uid}_body)`}
            filter={`url(#${uid}_soft)`}
          />
        </svg>
        </div>
      </div>
      <p className="mt-2.5 px-1 text-center text-[10px] leading-relaxed text-slate-500">
        正面人体为<strong className="font-medium text-slate-600">健康宣教示意图</strong>
        ，非影像学表现；外环为模型输出的相对指数示意，不可替代临床检查与医师判断。
      </p>
    </div>
  );
}

export function HomePage() {
  const accessToken = useStoredAccessToken();
  const [hoveredFactor, setHoveredFactor] = useState<number | null>(null);
  const [hoveredRoseSegment, setHoveredRoseSegment] = useState<number | null>(null);
  const [propagationSelectedId, setPropagationSelectedId] = useState<PropagationDiseaseId>('liver');
  const [remoteRisk, setRemoteRisk] = useState<RiskPredictResponse | null>(null);
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [questionnaireCompletion, setQuestionnaireCompletion] = useState(readQuestionnaireCompletion);
  const [remoteImagingCount, setRemoteImagingCount] = useState<number>(0);

  useEffect(() => {
    setQuestionnaireCompletion(readQuestionnaireCompletion());
  }, [accessToken]);

  useEffect(() => {
    const refreshQc = () => setQuestionnaireCompletion(readQuestionnaireCompletion());
    window.addEventListener(QUESTIONNAIRE_UPDATED_EVENT, refreshQc);
    window.addEventListener('storage', refreshQc);
    return () => {
      window.removeEventListener(QUESTIONNAIRE_UPDATED_EVENT, refreshQc);
      window.removeEventListener('storage', refreshQc);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setRiskLoading(true);
      fetchRiskPredict(getRiskPredictRequestBody())
        .then((r) => {
          if (!cancelled) {
            setRemoteRisk(r);
            setRiskError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setRiskError(e instanceof Error ? e.message : '风险评估加载失败');
          }
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

  useEffect(() => {
    let cancelled = false;
    const loadRemoteImaging = async () => {
      try {
        const axes = ['liver', 'diabetes', 'stroke'] as const;
        const metas = await Promise.all(axes.map((axis) => fetchUserAxisImageMeta(axis)));
        if (cancelled) return;
        const n = metas.filter((m) => m.exists).length;
        setRemoteImagingCount(n);
      } catch {
        if (!cancelled) setRemoteImagingCount(0);
      }
    };
    if (accessToken) loadRemoteImaging();
    const onUpdate = () => {
      if (accessToken) loadRemoteImaging();
    };
    window.addEventListener(QUESTIONNAIRE_UPDATED_EVENT, onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(QUESTIONNAIRE_UPDATED_EVENT, onUpdate);
    };
  }, [accessToken]);


  const questionnaireStatus = useMemo(() => {
    const qc = questionnaireCompletion;
    const localImgN =
      qc.imagingCounts.liver + qc.imagingCounts.diabetes + qc.imagingCounts.stroke;
    // 优先使用服务端已落盘影像数量，避免“已上传但本地计数仍为0%”
    const imgN = Math.max(localImgN, remoteImagingCount);
    const imagingProgress = Math.min(100, Math.round((imgN / 3) * 100));
    return [
      {
        id: 'basic',
        name: '基础信息',
        completed: qc.basicCompleted,
        progress: qc.basicProgress,
        icon: User,
        color: 'blue' as const,
      },
      {
        id: 'lifestyle',
        name: '生活习惯',
        completed: qc.lifestyleCompleted,
        progress: qc.lifestyleProgress,
        icon: Activity,
        color: 'purple' as const,
      },
      {
        id: 'indicators',
        name: '生理指标',
        completed: qc.indicatorsCompleted,
        progress: qc.indicatorsProgress,
        icon: Heart,
        color: 'orange' as const,
      },
      {
        id: 'imaging',
        name: '影像上传',
        completed: imgN > 0,
        progress: imagingProgress,
        icon: Upload,
        color: 'green' as const,
      },
      {
        id: 'derived',
        name: '衍生指标',
        completed: qc.derivedCompleted,
        progress: qc.derivedProgress,
        icon: Calculator,
        color: 'teal' as const,
      },
    ];
  }, [questionnaireCompletion, remoteImagingCount]);

  /** 患病风险因素（南丁格尔玫瑰图）；name + value 必填，color 可省略（按序号配色） */
  const ROSE_COLOR_FALLBACK = [
    '#dc2626', '#f97316', '#fbbf24', '#a3e635', '#84cc16', '#10b981', '#14b8a6', '#06b6d4',
    '#8b5cf6', '#ec4899', '#6366f1', '#0ea5e9',
  ];
  const riskFactorsRaw = useMemo(() => {
    if (!remoteRisk) return [] as { name: string; displayName: string; value: number; color?: string }[];
    const byName = new Map<string, number>();
    for (const d of remoteRisk.diseases) {
      for (const f of d.topFactors ?? []) {
        const v = typeof f.value === 'number' && !Number.isNaN(f.value) ? f.value : 0;
        byName.set(f.name, Math.max(byName.get(f.name) ?? 0, v));
      }
    }
    return Array.from(byName.entries()).map(([name, value]) => ({
      name,
      displayName: factorNameForDisplay(name),
      value: factorWeightToRosePercent(value),
    }));
  }, [remoteRisk]);
  const riskFactorsData = riskFactorsRaw
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((row, i) => ({
      name: row.name,
      displayName: row.displayName,
      value: row.value,
      color: row.color ?? ROSE_COLOR_FALLBACK[i % ROSE_COLOR_FALLBACK.length],
    }));

  const roseN = riskFactorsData.length;
  const roseSectorDeg = roseN > 0 ? 360 / roseN : 0;
  const roseHalfDeg = roseSectorDeg / 2;
  const roseMidAngles =
    roseN > 0
      ? riskFactorsData.map((_, i) => {
          const raw = 90 - i * roseSectorDeg;
          return ((raw % 360) + 360) % 360;
        })
      : [];
  const roseValueMin = roseN > 0 ? Math.min(...riskFactorsData.map((f) => f.value)) : 0;
  const roseValueMax = roseN > 0 ? Math.max(...riskFactorsData.map((f) => f.value)) : 100;
  const roseCx = 110;
  const roseCy = 110;
  const roseValueToOuterR = (value: number) => {
    if (roseValueMax <= roseValueMin) return 38 + 27;
    const t = (value - roseValueMin) / (roseValueMax - roseValueMin);
    return 38 + t * 54;
  };
  const rosePolar = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: roseCx + Math.cos(rad) * r, y: roseCy - Math.sin(rad) * r };
  };
  const roseSectorPath = (midDeg: number, outerR: number, halfDeg: number) => {
    const a0 = midDeg - halfDeg;
    const a1 = midDeg + halfDeg;
    const p0 = rosePolar(a0, outerR);
    const p1 = rosePolar(a1, outerR);
    const largeArc = roseSectorDeg >= 180 ? 1 : 0;
    return `M ${roseCx} ${roseCy} L ${p0.x} ${p0.y} A ${outerR} ${outerR} 0 ${largeArc} 1 ${p1.x} ${p1.y} Z`;
  };

  const diseaseRisks = useMemo(() => {
    const rec = (risk: 'low' | 'medium' | 'high') =>
      risk === 'high'
        ? '建议尽快就医检查'
        : risk === 'medium'
          ? '建议调整生活方式'
          : '保持良好生活习惯';
    const style = (risk: 'low' | 'medium' | 'high') =>
      risk === 'high'
        ? { color: 'red' as const, ringStroke: '#ef4444' }
        : risk === 'medium'
          ? { color: 'orange' as const, ringStroke: '#f97316' }
          : { color: 'emerald' as const, ringStroke: '#10b981' };

    const liverD = remoteRisk?.diseases.find((x) => x.id === 'liver');
    const dmD = remoteRisk?.diseases.find((x) => x.id === 'diabetes');
    const stD = remoteRisk?.diseases.find((x) => x.id === 'stroke');
    const hasData = !!remoteRisk;

    type RL = 'low' | 'medium' | 'high';
    const pendingStyle = { color: 'emerald' as const, ringStroke: '#94a3b8' };
    return [
      {
        name: '肝病',
        risk: (liverD?.risk ?? 'low') as RL,
        riskLevel: liverD?.riskLabel ?? (hasData ? '低风险' : '待评估'),
        score: liverD?.score ?? 0,
        icon: LiverIcon,
        ...(hasData && liverD ? style(liverD.risk) : pendingStyle),
        cardMuted: !hasData,
        factors: liverD?.topFactors?.length
          ? liverD.topFactors.map((f) => f.name)
          : hasData
            ? []
            : ['暂无模型输出，完成问卷并同步评估后显示'],
        recommendations: hasData && liverD ? rec(liverD.risk) : '完成数据采集后可查看评估建议。',
      },
      {
        name: '糖尿病',
        risk: (dmD?.risk ?? 'low') as RL,
        riskLevel: dmD?.riskLabel ?? (hasData ? '低风险' : '待评估'),
        score: dmD?.score ?? 0,
        icon: Droplet,
        ...(hasData && dmD ? style(dmD.risk) : pendingStyle),
        cardMuted: !hasData,
        factors: dmD?.topFactors?.length
          ? dmD.topFactors.map((f) => f.name)
          : hasData
            ? []
            : ['暂无模型输出，完成问卷并同步评估后显示'],
        recommendations: hasData && dmD ? rec(dmD.risk) : '完成数据采集后可查看评估建议。',
      },
      {
        name: '脑卒中',
        risk: (stD?.risk ?? 'low') as RL,
        riskLevel: stD?.riskLabel ?? (hasData ? '低风险' : '待评估'),
        score: stD?.score ?? 0,
        icon: Brain,
        ...(hasData && stD ? style(stD.risk) : pendingStyle),
        cardMuted: !hasData,
        factors: stD?.topFactors?.length
          ? stD.topFactors.map((f) => f.name)
          : hasData
            ? []
            : ['暂无模型输出，完成问卷并同步评估后显示'],
        recommendations: hasData && stD ? rec(stD.risk) : '完成数据采集后可查看评估建议。',
      },
    ];
  }, [remoteRisk]);

  const propagationDiseases = useMemo<PropagationDiseaseModel[]>(() => {
    const liverD = remoteRisk?.diseases.find((x) => x.id === 'liver');
    const dmD = remoteRisk?.diseases.find((x) => x.id === 'diabetes');
    const stD = remoteRisk?.diseases.find((x) => x.id === 'stroke');
    const hasData = !!remoteRisk;
    return [
      {
        id: 'liver',
        shortName: 'MAFLD',
        fullName: '肝病',
        risk: liverD?.risk ?? 'low',
        riskLabel: liverD?.riskLabel ?? (hasData ? '低风险' : '待评估'),
        probability: liverD?.probability ?? null,
        score: liverD?.score ?? 0,
        icon: LiverIcon,
        accent: 'emerald',
      },
      {
        id: 'diabetes',
        shortName: 'T2DM',
        fullName: '糖尿病',
        risk: dmD?.risk ?? 'low',
        riskLabel: dmD?.riskLabel ?? (hasData ? '低风险' : '待评估'),
        probability: dmD?.probability ?? null,
        score: dmD?.score ?? 0,
        icon: Droplet,
        accent: 'red',
      },
      {
        id: 'stroke',
        shortName: 'CVA',
        fullName: '脑卒中',
        risk: stD?.risk ?? 'low',
        riskLabel: stD?.riskLabel ?? (hasData ? '低风险' : '待评估'),
        probability: stD?.probability ?? null,
        score: stD?.score ?? 0,
        icon: Brain,
        accent: 'amber',
      },
    ];
  }, [remoteRisk]);

  const diseaseRingSize = 128;
  const diseaseRingCx = diseaseRingSize / 2;
  const diseaseRingCy = diseaseRingSize / 2;
  const diseaseRingR = 46;
  const diseaseRingStroke = 10;
  const diseaseRingLen = 2 * Math.PI * diseaseRingR;

  const handleNavigate = (page: string) => {
    const event = new CustomEvent('navigate', { detail: page });
    window.dispatchEvent(event);
  };

  const getHealthLevel = (score: number | null) => {
    if (score === null) return { level: '暂无评分', color: 'slate' as const };
    // 更细的等级划分：避免 60+ 一律“良好”
    if (score >= 90) return { level: '优秀', color: 'emerald' as const };
    if (score >= 75) return { level: '良好', color: 'blue' as const };
    if (score >= 60) return { level: '一般', color: 'orange' as const };
    if (score >= 45) return { level: '偏低', color: 'orange' as const };
    return { level: '较差', color: 'red' as const };
  };

  const hasEnoughDataForComposite = useMemo(() => {
    const qc = questionnaireCompletion;
    return qc.basicCompleted && qc.lifestyleCompleted && qc.indicatorsCompleted;
  }, [questionnaireCompletion]);

  const compositeHealthScore = riskAverageToHealthComposite(remoteRisk?.compositeIndex);
  const healthLevel = getHealthLevel(compositeHealthScore);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 px-4 pb-8 pt-2 sm:space-y-7 sm:px-6 sm:pb-10 sm:pt-3 lg:px-8 lg:pb-12">
      {/* Section 1: 问卷完成情况 + 玫瑰图 + 健康等级 */}
      <section className="overflow-visible rounded-2xl border border-gray-200/90 bg-white shadow-md ring-1 ring-gray-100/80">
        <div
          className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500"
          aria-hidden
        />
        <header className="relative overflow-hidden border-b border-gray-100/90">
          <div
            className="pointer-events-none absolute -right-20 -top-16 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-20 left-1/4 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl"
            aria-hidden
          />
          <div className="relative flex flex-col gap-3 px-5 pb-3 pt-5 sm:flex-row sm:items-start sm:gap-5 sm:px-8 sm:pb-4 sm:pt-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 ring-4 ring-white/80">
              <Sparkles className="h-6 w-6" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">工作台</p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">健康数据总览</h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600 sm:mt-2">
                采集进度、综合健康指数示意与模型解析的患病风险因素分布，便于您快速把握当前状态与后续行动。
              </p>
            </div>
          </div>
        </header>
        <div className="px-5 pb-5 pt-2 sm:px-8 sm:pb-8 sm:pt-3">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:items-stretch lg:gap-0">
          {/* 左侧：问卷完成情况 */}
          <div className="flex min-h-0 flex-col lg:pr-8 xl:pr-10">
            <h3 className="mb-4 flex min-h-[2.75rem] items-center justify-center gap-2 border-b border-slate-100 pb-3 text-center text-sm font-bold text-slate-900">
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600"
                aria-hidden
              />
              数据采集进度
            </h3>
            <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-200/70 bg-slate-50/50 p-3 shadow-inner ring-1 ring-slate-100/80 sm:p-4">
            {questionnaireStatus.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate('dataCollection')}
                className="group w-full rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-sm ring-1 ring-slate-50/90 transition-all hover:-translate-y-0.5 hover:border-emerald-200/80 hover:shadow-md hover:ring-emerald-100/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm',
                        item.color === 'blue' && 'bg-gradient-to-br from-blue-500 to-cyan-600',
                        item.color === 'purple' && 'bg-gradient-to-br from-purple-500 to-pink-600',
                        item.color === 'orange' && 'bg-gradient-to-br from-orange-500 to-red-600',
                        item.color === 'green' && 'bg-gradient-to-br from-green-500 to-emerald-600',
                        item.color === 'teal' && 'bg-gradient-to-br from-teal-500 to-emerald-700',
                        !['blue', 'purple', 'orange', 'green', 'teal'].includes(item.color) &&
                          'bg-gradient-to-br from-gray-400 to-gray-500',
                      )}
                    >
                      <item.icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="truncate text-sm font-medium text-slate-900">{item.name}</span>
                  </div>
                  {item.completed ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  )}
                </div>
                <div className="relative h-2 overflow-hidden rounded-full bg-white shadow-inner ring-1 ring-slate-200/80">
                  <div
                    className={cn(
                      'absolute left-0 top-0 h-full rounded-full transition-[width] duration-500 ease-out',
                      item.color === 'blue' && 'bg-gradient-to-r from-blue-500 to-cyan-600',
                      item.color === 'purple' && 'bg-gradient-to-r from-purple-500 to-pink-600',
                      item.color === 'orange' && 'bg-gradient-to-r from-orange-500 to-red-600',
                      item.color === 'green' && 'bg-gradient-to-r from-green-500 to-emerald-600',
                      item.color === 'teal' && 'bg-gradient-to-r from-teal-500 to-emerald-700',
                      !['blue', 'purple', 'orange', 'green', 'teal'].includes(item.color) &&
                        'bg-gradient-to-r from-gray-400 to-gray-500',
                    )}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <p className="mt-2 text-right text-xs tabular-nums text-slate-500">{item.progress}% 完成</p>
              </button>
            ))}
            </div>
          </div>

          {/* 中间：健康等级 — 标题与左右列同样式，内容垂直居中 */}
          <div className="flex h-full min-h-0 flex-col border-slate-100 lg:border-l lg:px-8 xl:px-10">
            <h3 className="mb-4 flex min-h-[2.75rem] w-full shrink-0 items-center justify-center gap-2 border-b border-slate-100 pb-3 text-center text-sm font-bold leading-6 text-slate-900">
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-sky-500 to-blue-600"
                aria-hidden
              />
              综合健康评分
            </h3>
            <div className="flex min-h-0 flex-1 flex-col items-stretch justify-center px-0 py-4 sm:py-6">
              <div className="mx-auto flex w-full min-w-0 flex-col items-center gap-6">
                <div className="flex w-full justify-center">
                  <HealthCompositeScoreGraphic
                    score={compositeHealthScore}
                    accent={healthLevel.color}
                  />
                </div>
                <div className="w-full text-center">
                  <div className="mb-1 text-5xl font-bold tabular-nums tracking-tight text-slate-900">
                    {compositeHealthScore !== null ? compositeHealthScore : '—'}
                  </div>
                  <div
                    className={`mb-1 text-base font-semibold ${
                      healthLevel.color === 'emerald'
                        ? 'text-emerald-600'
                        : healthLevel.color === 'blue'
                          ? 'text-blue-600'
                          : healthLevel.color === 'orange'
                            ? 'text-orange-600'
                            : healthLevel.color === 'slate'
                              ? 'text-slate-500'
                              : 'text-red-600'
                    }`}
                  >
                    {healthLevel.level}
                  </div>
                  {!hasEnoughDataForComposite && compositeHealthScore !== null ? (
                    <p className="mb-1 text-xs font-medium text-amber-600">
                      低置信度（数据不完整）
                    </p>
                  ) : null}
                  <p className="text-sm leading-relaxed text-slate-500">
                    {compositeHealthScore !== null
                      ? hasEnoughDataForComposite
                        ? '以下为模型综合指数示意，不替代诊疗。'
                        : '当前仅基于已填写字段估算，补全问卷后会更新。'
                      : '完成问卷并同步评估后将显示综合指数。'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 右侧：南丁格尔玫瑰图（纯文字外围标签，项数可扩展） */}
          <div className="flex h-full min-h-0 w-full flex-col lg:border-l lg:pl-8 xl:pl-10">
            <h3 className="mb-4 flex min-h-[2.75rem] w-full shrink-0 items-center justify-center gap-2 border-b border-slate-100 pb-3 text-center text-sm font-bold leading-6 text-slate-900">
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-rose-500 to-amber-500"
                aria-hidden
              />
              患病风险因素
            </h3>
            <div className="flex min-h-0 flex-1 items-center justify-center py-4">
            <div className="relative mx-auto min-h-[400px] w-full max-w-[400px] shrink-0 overflow-visible px-1 pb-4 pt-1">
              {roseN === 0 ? (
                <div className="mx-auto flex min-h-[320px] max-w-sm flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-6 py-10 text-center shadow-sm ring-1 ring-slate-100/80">
                  <AlertCircle className="h-10 w-10 text-slate-400" aria-hidden />
                  <p className="text-sm font-semibold text-slate-700">暂无 Top 风险因素</p>
                  <p className="max-w-xs text-xs leading-relaxed text-slate-500">
                    模型返回因子后将在此以玫瑰图展示；请先完成数据采集并确保评估接口可用。
                  </p>
                </div>
              ) : null}
              {roseN > 0 ? (
              <svg
                className="absolute left-1/2 top-1/2 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2"
                viewBox="0 0 220 220"
                aria-label="患病风险因素玫瑰图"
              >
                {[42, 56, 70, 84, 98].map((gr) => (
                  <circle
                    key={`rose-grid-c-${gr}`}
                    cx={roseCx}
                    cy={roseCy}
                    r={gr}
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth={1}
                  />
                ))}
                {roseMidAngles.map((mid, i) => {
                  const b = mid - roseHalfDeg;
                  const inner = 32;
                  const outer = 99;
                  const pIn = rosePolar(b, inner);
                  const pOut = rosePolar(b, outer);
                  return (
                    <line
                      key={`rose-grid-r-${riskFactorsData[i]?.name ?? i}`}
                      x1={pIn.x}
                      y1={pIn.y}
                      x2={pOut.x}
                      y2={pOut.y}
                      stroke="#e2e8f0"
                      strokeWidth={1}
                    />
                  );
                })}
                {riskFactorsData.map((factor, index) => {
                  const mid = roseMidAngles[index] ?? 0;
                  const outerR = roseValueToOuterR(factor.value);
                  return (
                    <path
                      key={`rose-path-${factor.name}`}
                      d={roseSectorPath(mid, outerR, roseHalfDeg)}
                      fill={factor.color}
                      opacity={hoveredRoseSegment === null || hoveredRoseSegment === index ? 0.95 : 0.5}
                      stroke="#fff"
                      strokeWidth={2.5}
                      className="cursor-pointer transition-opacity duration-200"
                      style={{
                        filter:
                          hoveredRoseSegment === index ? 'drop-shadow(0 3px 6px rgba(0,0,0,0.18))' : 'none',
                      }}
                      onMouseEnter={() => {
                        setHoveredRoseSegment(index);
                        setHoveredFactor(index);
                      }}
                      onMouseLeave={() => {
                        setHoveredRoseSegment(null);
                        setHoveredFactor(null);
                      }}
                    />
                  );
                })}
                <circle
                  cx={roseCx}
                  cy={roseCy}
                  r={26}
                  fill="white"
                  stroke="#f1f5f9"
                  strokeWidth={2}
                  className="pointer-events-none"
                  style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }}
                />
              </svg>
              ) : null}

              {/* 中心：红色感叹号提示 */}
              {roseN > 0 && (
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 flex h-[4.25rem] w-[4.25rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-sm ring-2 ring-slate-100"
                  role="img"
                  aria-label="风险关注提示"
                >
                  <AlertCircle className="h-8 w-8 text-red-500" strokeWidth={2.25} aria-hidden />
                </div>
              )}

              {/* 外围纯文字标签（与扇区一一对应） */}
              {riskFactorsData.map((factor, index) => {
                const mid = roseMidAngles[index] ?? 0;
                const labelR = Math.min(168, 124 + Math.min(roseN, 16) * 3);
                const angleRad = (mid * Math.PI) / 180;
                const x = Math.cos(angleRad) * labelR;
                const y = -Math.sin(angleRad) * labelR;
                const compactLabel = roseN > 12;

                return (
                  <div
                    key={`rose-label-${factor.name}-${index}`}
                    className="absolute z-10"
                    style={{
                      left: `calc(50% + ${x}px)`,
                      top: `calc(50% + ${y}px)`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <button
                      type="button"
                      className={`flex flex-col items-center gap-0.5 rounded-lg border border-gray-200 bg-white text-center shadow-md transition-all duration-200 hover:border-slate-300 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                        hoveredFactor === index ? 'scale-105 border-slate-300 shadow-lg' : ''
                      } ${compactLabel ? 'max-w-[5.5rem] px-1.5 py-1' : 'max-w-[7.5rem] px-2.5 py-1.5'}`}
                      onMouseEnter={() => {
                        setHoveredFactor(index);
                        setHoveredRoseSegment(index);
                      }}
                      onMouseLeave={() => {
                        setHoveredFactor(null);
                        setHoveredRoseSegment(null);
                      }}
                    >
                      <span
                        className={`font-medium leading-tight text-gray-800 ${
                          compactLabel ? 'text-[10px]' : 'text-xs'
                        }`}
                      >
                        {factor.displayName}
                      </span>
                      <span
                        className={`tabular-nums text-slate-500 ${
                          compactLabel ? 'text-[9px]' : 'text-[11px]'
                        }`}
                      >
                        {factor.value}%
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* Section 2: 三种疾病风险 */}
      <section className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-md ring-1 ring-gray-100/80">
        <div
          className="h-1 w-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-600"
          aria-hidden
        />
        <header className="relative flex flex-col gap-4 overflow-hidden border-b border-gray-100/90 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-6">
          <div
            className="pointer-events-none absolute -right-16 -top-12 h-40 w-40 rounded-full bg-rose-400/10 blur-3xl"
            aria-hidden
          />
          <div className="relative flex min-w-0 flex-1 gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-600 text-white shadow-lg shadow-rose-500/20 ring-2 ring-white/90">
              <Stethoscope className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">风险摘要</p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">风险评估</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">肝病、糖尿病与脑卒中模型输出摘要；详情以专页为准。</p>
              {riskLoading && (
                <p className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  正在同步模型结果…
                </p>
              )}
              {riskError && (
                <p className="mt-2 text-xs font-medium text-rose-600" role="alert">
                  {riskError}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleNavigate('riskAssessment')}
            className="relative inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50 to-teal-50/80 px-4 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-100/80 transition-all hover:border-emerald-300 hover:from-emerald-100/80 hover:to-teal-50 hover:shadow-md sm:self-auto"
          >
            查看详情
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-5 p-5 sm:gap-6 sm:p-8 md:grid-cols-3">
          {diseaseRisks.map((disease) => {
            const pct = Math.min(100, Math.max(0, disease.score));
            const arcDash = `${(pct / 100) * diseaseRingLen} ${diseaseRingLen}`;
            const muted = disease.cardMuted;
            return (
            <div
              key={disease.name}
              className={cn(
                'flex h-full flex-col rounded-2xl border p-6 shadow-sm ring-1 transition-all hover:-translate-y-0.5 hover:shadow-md',
                muted
                  ? 'border-slate-200/80 bg-slate-50/70 ring-slate-100/80 hover:border-slate-300/90'
                  : disease.risk === 'high'
                    ? 'border-red-200/80 bg-red-50/60 ring-red-100/60 hover:ring-red-200/50'
                    : disease.risk === 'medium'
                      ? 'border-orange-200/80 bg-orange-50/60 ring-orange-100/60 hover:ring-orange-200/50'
                      : 'border-emerald-200/80 bg-emerald-50/60 ring-emerald-100/60 hover:ring-emerald-200/50',
              )}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold text-slate-900">{disease.name}</h3>
                <div
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    muted
                      ? 'bg-slate-100 text-slate-700'
                      : disease.risk === 'high'
                        ? 'bg-red-100 text-red-800'
                        : disease.risk === 'medium'
                          ? 'bg-orange-100 text-orange-800'
                          : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {disease.riskLevel}
                </div>
              </div>

              <div
                className="relative mx-auto mb-5 flex h-[128px] w-[128px] shrink-0 items-center justify-center"
                role="img"
                aria-label={`${disease.name}，${disease.riskLevel}，圆环表示相对风险程度`}
              >
                <svg
                  width={diseaseRingSize}
                  height={diseaseRingSize}
                  viewBox={`0 0 ${diseaseRingSize} ${diseaseRingSize}`}
                  className="-rotate-90"
                  aria-hidden
                >
                  <circle
                    cx={diseaseRingCx}
                    cy={diseaseRingCy}
                    r={diseaseRingR}
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth={diseaseRingStroke}
                  />
                  <circle
                    cx={diseaseRingCx}
                    cy={diseaseRingCy}
                    r={diseaseRingR}
                    fill="none"
                    stroke={disease.ringStroke}
                    strokeWidth={diseaseRingStroke}
                    strokeLinecap="round"
                    strokeDasharray={arcDash}
                  />
                </svg>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <disease.icon
                    className={`h-8 w-8 shrink-0 ${
                      disease.color === 'emerald' ? 'text-emerald-600' :
                      disease.color === 'red' ? 'text-red-600' :
                      'text-orange-600'
                    }`}
                    aria-hidden
                  />
                </div>
              </div>
              <div className="mb-5 flex flex-1 flex-col space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">主要因素</p>
                <ul className="space-y-2">
                  {disease.factors.length === 0 ? (
                    <li className="text-sm text-slate-500">暂无 Top 因素</li>
                  ) : (
                    disease.factors.map((factor, idx) => (
                      <li key={idx} className="flex items-start gap-2.5 text-left">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            disease.color === 'emerald'
                              ? 'bg-emerald-500'
                              : disease.color === 'red'
                                ? 'bg-red-500'
                                : 'bg-orange-500'
                          }`}
                        />
                        <span className="text-sm leading-snug text-slate-600">{factor}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div
                className={`mt-auto rounded-xl border p-4 ${
                  muted
                    ? 'border-slate-200/80 bg-slate-100/60'
                    : disease.risk === 'high'
                      ? 'border-red-200/80 bg-red-100/80'
                      : disease.risk === 'medium'
                        ? 'border-orange-200/80 bg-orange-100/80'
                        : 'border-emerald-200/80 bg-emerald-100/80'
                }`}
              >
                <p className="text-sm font-medium leading-relaxed text-slate-700">{disease.recommendations}</p>
              </div>
            </div>
            );
          })}
        </div>
      </section>

      {/* 疾病关联风险传播（与风险评估页同源逻辑，简要版） */}
      <div className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-md ring-1 ring-gray-100/80">
        <DiseaseRiskPropagationModule
          diseases={propagationDiseases}
          propagationScores={remoteRisk?.propagationScores}
          selectedId={propagationSelectedId}
          onSelectDisease={setPropagationSelectedId}
          compact
          className="rounded-none border-0 shadow-none ring-0"
        />
        <div className="flex justify-end border-t border-gray-100/90 bg-slate-50/50 px-4 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={() => handleNavigate('riskAssessment')}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50/90 hover:text-emerald-800"
          >
            查看完整传播分析
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </button>
        </div>
      </div>

      </div>
    </div>
  );
}