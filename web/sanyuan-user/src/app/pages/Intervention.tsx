import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertCircle,
  ClipboardList,
  Crosshair,
  Sparkles,
  Lightbulb,
  Loader2,
  RefreshCw,
  MapPin,
  HeartPulse,
  MoonStar,
  Phone,
  Stethoscope,
  UtensilsCrossed,
  FileText,
} from 'lucide-react';
import { HealthGuideArticlePage } from '@/app/components/HealthGuideArticlePage';
import {
  fetchLatestPhysicalExamReportDetail,
  PhysicalExamReportModal,
} from '@/app/components/HealthLog';
import { cn } from '@/app/components/ui/utils';
import { fetchInterventionHospitals, type InterventionHospital } from '@/lib/api/hospitals';
import { fetchHealthGuidesRecommended, type HealthGuideArticle } from '@/lib/api/healthGuides';
import {
  clearAiInterventionClientCache,
  fetchAiInterventionRecommendation,
  readAiInterventionClientCache,
  writeAiInterventionClientCache,
  type AiInterventionRecommendation,
} from '@/lib/api/aiIntervention';
import { fetchRiskPredict, type RiskPredictResponse } from '@/lib/api/riskPredict';
import type { HealthHistoryDetailResponse } from '@/lib/api/healthHistory';
import { formatDistanceKm, haversineDistanceKm } from '@/lib/geo';
import { useGeolocation } from '@/lib/useGeolocation';
import { QUESTIONNAIRE_UPDATED_EVENT } from '@/lib/questionnaireSnapshot';
import { useStoredAccessToken } from '@/lib/useStoredAccessToken';

type HospitalWithDistance = InterventionHospital & { distanceKm: number | null };

function AiRecBulletList({ items, accent = 'emerald' as const }: { items: string[]; accent?: 'emerald' | 'teal' | 'cyan' }) {
  const ring =
    accent === 'teal'
      ? 'from-teal-500/12 to-emerald-500/5 text-teal-800 ring-teal-200/60'
      : accent === 'cyan'
        ? 'from-cyan-500/12 to-teal-500/5 text-cyan-900 ring-cyan-200/60'
        : 'from-emerald-500/12 to-teal-500/5 text-emerald-900 ring-emerald-200/60';

  return (
    <ul className="space-y-3.5">
      {items.map((t, idx) => (
        <li key={`${idx}-${t.slice(0, 24)}`} className="flex gap-3.5">
          <span
            className={cn(
              'flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-sm font-bold tabular-nums ring-1',
              ring,
            )}
            aria-hidden
          >
            {idx + 1}
          </span>
          <span className="pt-0.5 text-sm leading-relaxed text-gray-700">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function AiRecInsightCard({
  icon: Icon,
  title,
  subtitle,
  topBarClass,
  iconWrapClass,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  topBarClass: string;
  iconWrapClass: string;
  children: React.ReactNode;
}) {
  return (
    <section className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100/90 bg-white shadow-sm ring-1 ring-gray-100/90 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/5 hover:ring-emerald-100/80">
      <div className={cn('h-1 w-full shrink-0 bg-gradient-to-r', topBarClass)} aria-hidden />
      <div className="flex flex-1 flex-col p-5 sm:p-5">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1',
              iconWrapClass,
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
          </div>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs leading-snug text-gray-500">{subtitle}</p> : null}
          </div>
        </div>
        <div className="mt-5 flex-1 border-t border-gray-100/90 pt-4">{children}</div>
      </div>
    </section>
  );
}

/** 与首页类似的宣教用人型示意；高风险病种以淡色区提示（非成像） */
function InterventionRiskFigure({ riskPredict }: { riskPredict: RiskPredictResponse | null }) {
  const strokeHigh =
    riskPredict?.diseases.some((d) => d.id === 'stroke' && d.risk === 'high') ?? false;
  const diabetesHigh =
    riskPredict?.diseases.some((d) => d.id === 'diabetes' && d.risk === 'high') ?? false;
  const liverHigh =
    riskPredict?.diseases.some((d) => d.id === 'liver' && d.risk === 'high') ?? false;

  const bodyPath =
    'M 60 18 C 76 18 86 28 86 42 C 86 54 80 60 70 62 L 68 68 C 88 74 100 92 102 112 C 104 128 98 138 86 142 L 88 156 ' +
    'C 90 186 86 210 80 234 L 66 236 L 60 216 L 54 236 L 40 234 C 34 210 30 186 32 156 L 34 142 C 22 138 16 128 18 112 ' +
    'C 20 92 32 74 52 68 L 50 62 C 40 60 34 54 34 42 C 34 28 44 18 60 18 Z';

  return (
    <aside className="relative overflow-hidden rounded-2xl border border-gray-100/90 bg-gradient-to-b from-white via-slate-50/40 to-emerald-50/20 p-5 shadow-md ring-1 ring-gray-100/90">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgb(148 163 184 / 0.18) 1px, transparent 0)`,
          backgroundSize: '20px 20px',
        }}
        aria-hidden
      />
      <p className="relative text-center text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
        风险示意
      </p>
      <svg
        viewBox="0 0 120 248"
        className="relative mx-auto mt-3 block h-52 w-auto max-w-[7.5rem] drop-shadow-sm"
        shapeRendering="geometricPrecision"
        aria-hidden
      >
        <defs>
          <linearGradient id="interventionFigBody" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#e8eef3" />
            <stop offset="45%" stopColor="#d1dce6" />
            <stop offset="100%" stopColor="#8b9caa" />
          </linearGradient>
        </defs>
        {strokeHigh ? (
          <ellipse cx="60" cy="44" rx="20" ry="24" fill="#fda4af" fillOpacity={0.22} />
        ) : null}
        {(diabetesHigh || liverHigh) && !strokeHigh ? (
          <ellipse cx="60" cy="118" rx="22" ry="28" fill="#fcd34d" fillOpacity={0.14} />
        ) : null}
        {(diabetesHigh || liverHigh) && strokeHigh ? (
          <ellipse cx="60" cy="118" rx="22" ry="28" fill="#fcd34d" fillOpacity={0.12} />
        ) : null}
        <path d={bodyPath} fill="url(#interventionFigBody)" opacity={0.95} />
      </svg>
      <p className="relative mt-4 text-center text-xs leading-relaxed text-gray-600">
        {strokeHigh
          ? '模型提示脑卒中风险偏高：请优先遵循右侧运动与生活习惯要点，并及时就医评估。'
          : diabetesHigh || liverHigh
            ? '请结合代谢相关建议管理体重、血糖与血脂。'
            : '正面轮廓为健康宣教示意图，配合文字建议阅读。'}
      </p>
    </aside>
  );
}

export function Intervention() {
  const accessToken = useStoredAccessToken();
  const geo = useGeolocation();
  const [primarySection, setPrimarySection] = useState<'ai' | 'guide' | 'medical'>('ai');
  const [guides, setGuides] = useState<HealthGuideArticle[]>([]);
  const [guideLoading, setGuideLoading] = useState(true);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [guideDetail, setGuideDetail] = useState<HealthGuideArticle | null>(null);

  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRec, setAiRec] = useState<AiInterventionRecommendation | null>(null);

  const [riskPredict, setRiskPredict] = useState<RiskPredictResponse | null>(null);
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [hospitals, setHospitals] = useState<InterventionHospital[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(true);
  const [hospitalsError, setHospitalsError] = useState<string | null>(null);

  const [peReportOpen, setPeReportOpen] = useState(false);
  const [peReportLoading, setPeReportLoading] = useState(false);
  const [peReportError, setPeReportError] = useState<string | null>(null);
  const [peReportDetail, setPeReportDetail] = useState<HealthHistoryDetailResponse | null>(null);

  const sortedHospitals = useMemo((): HospitalWithDistance[] => {
    const mapped: HospitalWithDistance[] = hospitals.map((h) => ({
      ...h,
      distanceKm:
        geo.latitude != null && geo.longitude != null
          ? haversineDistanceKm(geo.latitude, geo.longitude, h.latitude, h.longitude)
          : null,
    }));
    if (geo.latitude != null && geo.longitude != null) {
      return [...mapped].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }
    return mapped;
  }, [hospitals, geo.latitude, geo.longitude]);

  useEffect(() => {
    let cancelled = false;
    const loadRisk = () => {
      setRiskLoading(true);
      fetchRiskPredict()
        .then((r) => {
          if (cancelled) return;
          setRiskPredict(r);
          setRiskError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setRiskPredict(null);
          setRiskError(e instanceof Error ? e.message : '风险数据加载失败');
        })
        .finally(() => {
          if (!cancelled) setRiskLoading(false);
        });
    };
    loadRisk();
    window.addEventListener(QUESTIONNAIRE_UPDATED_EVENT, loadRisk);
    return () => {
      cancelled = true;
      window.removeEventListener(QUESTIONNAIRE_UPDATED_EVENT, loadRisk);
    };
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setGuideLoading(true);
      fetchHealthGuidesRecommended()
        .then((rows) => {
          if (cancelled) return;
          setGuides(rows);
          setGuideError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setGuideError(e instanceof Error ? e.message : '加载健康生活指南失败');
        })
        .finally(() => {
          if (!cancelled) setGuideLoading(false);
        });
    };
    load();
    window.addEventListener(QUESTIONNAIRE_UPDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(QUESTIONNAIRE_UPDATED_EVENT, load);
    };
  }, [accessToken]);

  const loadAi = useCallback(
    async (forceRefresh = false) => {
      if (!accessToken) {
        setAiRec(null);
        setAiLoading(false);
        setAiError(null);
        return;
      }
      if (!forceRefresh) {
        const cached = readAiInterventionClientCache();
        if (cached) {
          setAiRec(cached);
          setAiError(null);
          setAiLoading(false);
          return;
        }
      }
      setAiLoading(true);
      setAiError(null);
      try {
        const r = await fetchAiInterventionRecommendation({ refresh: forceRefresh });
        setAiRec(r);
        writeAiInterventionClientCache(r);
        setAiError(null);
      } catch (e: unknown) {
        setAiRec(null);
        setAiError(e instanceof Error ? e.message : 'AI 推荐加载失败');
      } finally {
        setAiLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    void loadAi(false);
  }, [loadAi]);

  useEffect(() => {
    const onQuestionnaireUpdated = () => {
      clearAiInterventionClientCache();
      void loadAi(false);
    };
    window.addEventListener(QUESTIONNAIRE_UPDATED_EVENT, onQuestionnaireUpdated);
    return () => window.removeEventListener(QUESTIONNAIRE_UPDATED_EVENT, onQuestionnaireUpdated);
  }, [loadAi]);

  useEffect(() => {
    let cancelled = false;
    const loadHospitals = () => {
      setHospitalsLoading(true);
      fetchInterventionHospitals()
        .then((rows) => {
          if (cancelled) return;
          setHospitals(rows);
          setHospitalsError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setHospitals([]);
          setHospitalsError(e instanceof Error ? e.message : '加载医院列表失败');
        })
        .finally(() => {
          if (!cancelled) setHospitalsLoading(false);
        });
    };
    loadHospitals();
  }, [accessToken]);

  const openLatestPhysicalExamReport = useCallback(async () => {
    setPeReportOpen(true);
    setPeReportLoading(true);
    setPeReportError(null);
    setPeReportDetail(null);
    if (!accessToken) {
      setPeReportError('请先登录后再查看体检报告。');
      setPeReportLoading(false);
      return;
    }
    const r = await fetchLatestPhysicalExamReportDetail();
    if (!r.ok) {
      setPeReportError(r.error);
    } else {
      setPeReportDetail(r.detail);
    }
    setPeReportLoading(false);
  }, [accessToken]);

  const emptyHintGuide = (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center">
      <p className="text-sm font-medium text-gray-700">暂无推荐内容</p>
      <p className="mt-2 text-xs text-gray-500">接入内容源后将在此展示健康生活指南内容。</p>
    </div>
  );

  const emptyHintMedical = (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center">
      <p className="text-sm font-medium text-gray-700">暂无医院数据</p>
      <p className="mt-2 text-xs text-gray-500">请稍后重试或联系管理员维护医院库。</p>
    </div>
  );

  const aiAdviceBlock = (
    <div className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-md ring-1 ring-gray-100/80">
      <div className="relative overflow-hidden border-b border-gray-100/80">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-emerald-400/15 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-28 -left-20 h-48 w-48 rounded-full bg-teal-400/12 blur-3xl"
          aria-hidden
        />
        <div className="relative px-6 py-6 sm:px-8 sm:py-7">
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 ring-4 ring-white/60">
              <Sparkles className="h-7 w-7" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-[1.35rem]">AI 个性化推荐</h2>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                  模型生成
                </span>
                <button
                  type="button"
                  onClick={() => void loadAi(true)}
                  disabled={aiLoading || !accessToken}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-emerald-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-50/90 disabled:pointer-events-none disabled:opacity-50 sm:ml-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${aiLoading ? 'animate-spin' : ''}`} aria-hidden />
                  重新分析
                </button>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600 sm:text-base">
                结合当前风险分层与问卷生活习惯，整理为可执行的饮食、运动与日常管理要点，便于对照落实。
              </p>
              <p className="mt-3 inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-emerald-500" aria-hidden />
                  健康教育与自我管理参考
                </span>
                <span className="hidden text-gray-300 sm:inline" aria-hidden>
                  |
                </span>
                <span>不替代临床诊疗；不适请及时就医</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-b from-slate-50/80 via-slate-50/40 to-white px-5 py-6 sm:px-7 sm:py-8">
        {aiLoading ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-gray-200 bg-white/90 py-16 shadow-inner">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 ring-1 ring-emerald-100">
              <Loader2 className="h-7 w-7 animate-spin text-emerald-600" aria-hidden />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-800">正在生成个性化建议</p>
              <p className="mt-1.5 text-xs text-gray-500">通常需要数秒至数十秒，请稍候</p>
            </div>
          </div>
        ) : aiError ? (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200/90 bg-rose-50/95 px-5 py-4 text-sm text-rose-900 shadow-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden />
            <span>{aiError}</span>
          </div>
        ) : aiRec ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-stretch">
            <AiRecInsightCard
              icon={ClipboardList}
              title="推荐理由"
              subtitle="与当前评估结果、习惯因素相关的要点"
              topBarClass="from-emerald-500 via-teal-500 to-emerald-600"
              iconWrapClass="bg-gradient-to-br from-emerald-50 to-teal-50/80 text-emerald-700 ring-emerald-100/90"
            >
              <AiRecBulletList items={aiRec.reasons} accent="emerald" />
            </AiRecInsightCard>

            <AiRecInsightCard
              icon={UtensilsCrossed}
              title="饮食建议"
              subtitle="膳食结构与热量、营养素的一般原则"
              topBarClass="from-teal-500 via-cyan-500 to-teal-600"
              iconWrapClass="bg-gradient-to-br from-teal-50 to-cyan-50/70 text-teal-800 ring-teal-100/90"
            >
              <AiRecBulletList items={aiRec.diet} accent="teal" />
            </AiRecInsightCard>

            <AiRecInsightCard
              icon={Activity}
              title="运动与生活习惯"
              subtitle="身体活动、作息与心理调节"
              topBarClass="from-cyan-500 via-emerald-500 to-teal-500"
              iconWrapClass="bg-gradient-to-br from-cyan-50 to-emerald-50/70 text-cyan-900 ring-cyan-100/90"
            >
              <div className="space-y-5">
                <div>
                  <div className="mb-3 flex items-center gap-2 text-emerald-900/90">
                    <Activity className="h-4 w-4 text-emerald-600" aria-hidden />
                    <span className="text-xs font-bold uppercase tracking-wider">运动</span>
                  </div>
                  <AiRecBulletList items={aiRec.exercise} accent="cyan" />
                </div>
                <div className="border-t border-gray-100/90 pt-5">
                  <div className="mb-3 flex items-center gap-2 text-emerald-900/90">
                    <MoonStar className="h-4 w-4 text-teal-600" aria-hidden />
                    <span className="text-xs font-bold uppercase tracking-wider">生活习惯</span>
                  </div>
                  <AiRecBulletList items={aiRec.lifestyle} accent="emerald" />
                </div>
              </div>
            </AiRecInsightCard>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="min-w-0 shrink-0 lg:max-w-[min(100%,28rem)]">
            <h1 className="mb-2 text-2xl font-bold text-gray-900">干预方案</h1>
            <p className="text-gray-600">根据您的健康状况，为您推荐定制化的改善方案</p>
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-stretch justify-center gap-2 sm:items-center lg:px-2">
            <p className="text-center text-xs font-medium uppercase tracking-wide text-gray-500">
              疾病风险程度
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-center">
              {riskLoading ? (
                <span className="text-sm text-gray-400">风险同步中…</span>
              ) : riskError ? (
                <span className="text-sm text-rose-600">{riskError}</span>
              ) : riskPredict ? (
                riskPredict.diseases.map((d) => (
                  <div
                    key={d.id}
                    className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/90 px-3 py-2 shadow-sm"
                  >
                    <span className="truncate text-sm font-medium text-gray-800">{d.fullName}</span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        d.risk === 'high'
                          ? 'bg-rose-100 text-rose-900 ring-1 ring-rose-200'
                          : d.risk === 'medium'
                            ? 'bg-amber-50 text-amber-950 ring-1 ring-amber-200'
                            : 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200'
                      }`}
                    >
                      {d.riskLabel}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-sm text-gray-400">暂无评估数据</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <button
              type="button"
              onClick={() => void openLatestPhysicalExamReport()}
              disabled={peReportLoading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200/90 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 shadow-sm ring-1 ring-emerald-100/80 transition-colors hover:bg-emerald-50/90 disabled:pointer-events-none disabled:opacity-60"
            >
              {peReportLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
              )}
              查看本次体检报告
            </button>
            <div className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 md:flex">
              <Lightbulb className="h-8 w-8 text-white" />
            </div>
          </div>
        </div>
      </div>

      <PhysicalExamReportModal
        open={peReportOpen}
        onClose={() => {
          setPeReportOpen(false);
          setPeReportError(null);
          setPeReportDetail(null);
        }}
        loading={peReportLoading}
        errorMsg={peReportError}
        detail={peReportDetail}
      />

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setPrimarySection('ai')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-all ${
              primarySection === 'ai'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            AI个性化推荐
          </button>
          <button
            type="button"
            onClick={() => setPrimarySection('guide')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-all ${
              primarySection === 'guide'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <HeartPulse className="h-4 w-4" />
            健康生活指南
          </button>
          <button
            type="button"
            onClick={() => {
              setPrimarySection('medical');
              if (geo.status === 'idle') {
                geo.request();
              }
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-all ${
              primarySection === 'medical'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Stethoscope className="h-4 w-4" />
            及时就医推荐
          </button>
        </div>
      </div>

      {primarySection === 'ai' ? (
        aiAdviceBlock
      ) : primarySection === 'guide' ? (
        <div className="space-y-4">
          {guideLoading ? (
            <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-gray-500">
              <Loader2 className="mx-auto h-6 w-6 animate-spin" />
              <p className="mt-3 text-sm">正在加载健康生活指南...</p>
            </div>
          ) : guideError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-6 py-6 text-rose-800">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="h-4 w-4" />
                加载失败
              </div>
              <p className="mt-1 text-xs">{guideError}</p>
            </div>
          ) : guideDetail ? (
            <HealthGuideArticlePage article={guideDetail} onBack={() => setGuideDetail(null)} />
          ) : guides.length === 0 ? (
            emptyHintGuide
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {guides.map((article) => {
              const firstImage = article.images[0];
              return (
                <article
                  key={article.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看全文：${article.title}`}
                  onClick={() => setGuideDetail(article)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setGuideDetail(article);
                    }
                  }}
                  className="cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm outline-none transition-shadow hover:border-emerald-200/80 hover:shadow-md focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                >
                  {firstImage ? (
                    <img
                      src={firstImage.imageUrl}
                      alt={firstImage.desc || article.title}
                      className="h-48 w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-48 items-center justify-center bg-gray-100 text-sm text-gray-400">
                      暂无配图
                    </div>
                  )}
                  <div className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {article.type}
                      </span>
                      {article.riskLevel.map((rl) => (
                        <span key={`${article.id}-rl-${rl}`} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {rl}
                        </span>
                      ))}
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">{article.title}</h3>
                    <p className="line-clamp-3 text-sm leading-relaxed text-gray-600">{article.summary}</p>
                    {article.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {article.tags.map((tag) => (
                          <span
                            key={`${article.id}-tag-${tag}`}
                            className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-emerald-700">点击查看全文 →</p>
                  </div>
                </article>
              );
            })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium text-gray-900">附近医院与就医机构</p>
                <p className="mt-1 text-xs text-gray-500">
                  点击获取定位后，将按与您当前位置的直线距离由近到远排序（大圆距离，仅供参考）。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => geo.request()}
              disabled={geo.status === 'requesting'}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {geo.status === 'requesting' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crosshair className="h-4 w-4" />
              )}
              获取我的位置
            </button>
          </div>

          {geo.status === 'ok' && geo.latitude != null && geo.longitude != null ? (
            <p className="text-xs text-emerald-800">
              已获取位置（约 {geo.latitude.toFixed(4)}°N, {geo.longitude.toFixed(4)}°E
              {geo.accuracyM != null ? `，精度约 ${Math.round(geo.accuracyM)} 米` : ''}
              ），列表已按距离排序。
            </p>
          ) : null}
          {geo.status === 'idle' || geo.status === 'denied' || geo.status === 'error' || geo.status === 'unavailable' ? (
            <p className="text-xs text-gray-500">
              {geo.status === 'idle'
                ? '未定位时按默认顺序展示；定位成功后将自动按距离排序。'
                : null}
              {geo.errorMessage ? <span className="text-rose-600"> {geo.errorMessage}</span> : null}
              {geo.status === 'unavailable' && !geo.errorMessage ? (
                <span className="text-rose-600">当前浏览器不支持定位。</span>
              ) : null}
            </p>
          ) : null}

          {hospitalsLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-12 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">加载医院列表…</span>
            </div>
          ) : hospitalsError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-6 py-6 text-rose-800">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="h-4 w-4" />
                {hospitalsError}
              </div>
            </div>
          ) : sortedHospitals.length === 0 ? (
            emptyHintMedical
          ) : (
            <div className="space-y-4">
              {sortedHospitals.slice(0, 5).map((hospital) => (
                <div
                  key={hospital.id}
                  className="relative rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
                >
                  {hospital.distanceKm != null ? (
                    <div className="absolute right-4 top-4 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                      {formatDistanceKm(hospital.distanceKm)}
                    </div>
                  ) : null}
                  <h3 className="pr-24 text-lg font-semibold text-gray-900 sm:text-xl">{hospital.name}</h3>
                  <p className="mt-1 text-sm font-medium text-emerald-700">{hospital.department}</p>
                  <p className="mt-3 flex items-start gap-2 text-sm text-gray-600">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    <span>{hospital.address}</span>
                  </p>
                  <p className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                    <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                    <a href={`tel:${hospital.phone.replace(/\s/g, '')}`} className="text-emerald-700 hover:underline">
                      {hospital.phone}
                    </a>
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    <span>专家约 {hospital.experts} 人</span>
                  </div>
                  {hospital.specialties.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {hospital.specialties.map((s) => (
                        <span
                          key={`${hospital.id}-sp-${s}`}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
