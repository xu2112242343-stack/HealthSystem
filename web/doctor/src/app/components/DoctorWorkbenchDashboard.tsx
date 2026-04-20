import React, { lazy, Suspense, useMemo } from 'react';
import { useAsyncData } from '@shared/react/useAsyncData';
import {
  fetchDiseaseAnalysisDashboard,
  invalidateDiseaseAnalysisDashboardCache,
} from '@/lib/api/diseaseAnalysisDashboard';
import { Loader2 } from 'lucide-react';

const DoctorWorkbenchCharts = lazy(() => import('./DoctorWorkbenchCharts'));

export function DoctorWorkbenchDashboard() {
  const { data, loading, error, reload } = useAsyncData(() => fetchDiseaseAnalysisDashboard(0), []);

  const analyzedCount = useMemo(() => {
    if (!data) return 0;
    const m = data.meta?.analyzedPatients;
    if (m != null) return m;
    return data.overallRiskDist.low + data.overallRiskDist.mid + data.overallRiskDist.high;
  }, [data]);

  /** 已登记患者总数（user_info 行数）；与下方图表样本量可能不同 */
  const totalRegistered = useMemo(() => {
    if (!data) return 0;
    return data.meta?.totalRegisteredPatients ?? analyzedCount;
  }, [data, analyzedCount]);

  const riskBar = useMemo(() => {
    if (!data) return [] as Array<{ level: string; count: number; fill: string }>;
    return [
      { level: '低风险', count: data.overallRiskDist.low, fill: '#14b8a6' },
      { level: '中风险', count: data.overallRiskDist.mid, fill: '#f97316' },
      { level: '高风险', count: data.overallRiskDist.high, fill: '#ef4444' },
    ];
  }, [data]);

  const pieData = useMemo(() => {
    if (!data) return [] as Array<{ name: string; value: number }>;
    const r = data.comorbidityRegions;
    return [
      { name: 'MAFLD', value: r['1'] + r['12'] + r['13'] + r['123'] },
      { name: 'T2DM', value: r['2'] + r['12'] + r['23'] + r['123'] },
      { name: 'CVA', value: r['3'] + r['13'] + r['23'] + r['123'] },
    ];
  }, [data]);

  const topFactors = useMemo(() => {
    if (!data) return [] as Array<{ name: string; value: number; color: string }>;
    const byName = new Map<string, number>();
    for (const group of data.factors) {
      for (const f of group.factors) {
        const val = Math.max(0, Math.min(100, Math.round(Number(f.value) * 100)));
        byName.set(f.name, Math.max(byName.get(f.name) ?? 0, val));
      }
    }
    const palette = ['#ef4444', '#f97316', '#ea580c', '#ca8a04', '#0891b2', '#2563eb', '#7c3aed'];
    return Array.from(byName.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((x, i) => ({ ...x, color: palette[i % palette.length] }));
  }, [data]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1600px] p-6">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white py-14 text-gray-500">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
          <span className="text-sm">正在加载工作台数据…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[1600px] p-6">
        <div
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <span>{error ? `加载失败：${error.message}` : '暂无数据'}</span>
          <button
            type="button"
            onClick={() => {
              invalidateDiseaseAnalysisDashboardCache();
              reload();
            }}
            className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-100/80"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6">
      <header className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <h1 className="text-lg font-semibold text-gray-900">工作台总览</h1>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">总体统计</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">总患者数</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{totalRegistered}</p>
          </div>
          <div className="rounded-lg border border-red-100 bg-red-50 p-4">
            <p className="text-xs font-medium text-red-700">高风险人数</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-red-700">{data.overallRiskDist.high}</p>
          </div>
          <div className="rounded-lg border border-orange-100 bg-orange-50 p-4">
            <p className="text-xs font-medium text-orange-800">中风险人数</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-orange-700">{data.overallRiskDist.mid}</p>
          </div>
          <div className="rounded-lg border border-teal-100 bg-teal-50 p-4">
            <p className="text-xs font-medium text-teal-800">低风险人数</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-teal-700">{data.overallRiskDist.low}</p>
          </div>
        </div>
      </section>

      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="h-80 animate-pulse rounded-xl bg-slate-100/90" />
              <div className="h-80 animate-pulse rounded-xl bg-slate-100/90" />
            </div>
            <div className="h-72 animate-pulse rounded-xl bg-slate-100/90" />
            <div className="h-64 animate-pulse rounded-xl bg-slate-100/90" />
          </div>
        }
      >
        <DoctorWorkbenchCharts
          riskBar={riskBar}
          pieData={pieData}
          comorbidityRegions={data.comorbidityRegions}
          topFactors={topFactors}
        />
      </Suspense>
    </div>
  );
}
