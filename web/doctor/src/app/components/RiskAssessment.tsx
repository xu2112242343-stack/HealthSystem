import React, { useMemo, useState } from 'react';
import { Brain, Droplet, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { LiverIcon } from '@/app/components/icons/LiverIcon';
import {
  DiseaseRiskPropagationModule,
  type PropagationDiseaseId,
  type PropagationDiseaseModel,
} from '@/app/components/risk/DiseaseRiskPropagationModule';
import { useAsyncData } from '@shared/react/useAsyncData';
import {
  fetchDiseaseAnalysisDashboard,
  invalidateDiseaseAnalysisDashboardCache,
} from '@/lib/api/diseaseAnalysisDashboard';
import { ConditionalProbabilityLollipopChart } from '@/app/components/charts/ConditionalProbabilityLollipopChart';
import { DiseaseInternalRiskStructureChart } from '@/app/components/charts/DiseaseInternalRiskStructureChart';
import { FactorContributionRadarChart } from '@/app/components/charts/FactorContributionRadarChart';
import { GlucoseDistributionTwinAreaChart } from '@/app/components/charts/GlucoseDistributionTwinAreaChart';
import { StrokeRiskRadialBandsChart } from '@/app/components/charts/StrokeRiskRadialBandsChart';

export function RiskAssessment() {
  const [propagationSelectedId, setPropagationSelectedId] = useState<PropagationDiseaseId>('liver');

  const { data, loading, error, reload } = useAsyncData(() => fetchDiseaseAnalysisDashboard(0), []);

  const propagationDiseases = useMemo<PropagationDiseaseModel[]>(() => {
    if (!data) return [];
    const [s0, s1, s2] = data.propagationScores;
    return [
      {
        id: 'liver',
        shortName: 'MAFLD',
        fullName: '肝病',
        risk: 'low',
        riskLabel: '低风险',
        score: s0,
        icon: LiverIcon,
        accent: 'emerald',
      },
      {
        id: 'diabetes',
        shortName: 'T2DM',
        fullName: '糖尿病',
        risk: 'high',
        riskLabel: '高风险',
        score: s1,
        icon: Droplet,
        accent: 'red',
      },
      {
        id: 'stroke',
        shortName: 'CVA',
        fullName: '脑卒中',
        risk: 'medium',
        riskLabel: '中风险',
        score: s2,
        icon: Brain,
        accent: 'amber',
      },
    ];
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex flex-col items-center justify-center gap-3 text-gray-500">
        <Loader2 className="h-10 w-10 animate-spin text-teal-600" aria-hidden />
        <p className="text-sm">正在加载疾病分析数据…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 max-w-6xl mx-auto">
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          role="alert"
        >
          <span>{error ? `加载失败：${error.message}` : '暂无数据'}</span>
          <button
            type="button"
            onClick={() => {
              invalidateDiseaseAnalysisDashboardCache();
              reload();
            }}
            className="shrink-0 rounded-lg bg-white px-3 py-2 text-red-800 ring-1 ring-red-200 hover:bg-red-100/80 text-xs font-medium"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const { dmNafld, strokeByDm, riskStruct, factors, glucoseHist } = data;
  const defaultTab = factors[0]?.disease ?? '脂肪肝';

  return (
    <div className="min-h-screen bg-gray-50 p-6 max-w-6xl mx-auto space-y-6">
      {propagationDiseases.length === 3 ? (
        <DiseaseRiskPropagationModule
          diseases={propagationDiseases}
          selectedId={propagationSelectedId}
          onSelectDisease={setPropagationSelectedId}
          compact
          className="border-gray-200"
        />
      ) : null}

      {/* 一、条件概率：双轨棒棒糖图 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold text-gray-900">脂肪肝对糖尿病风险的影响</h2>
        <div className="mt-6 pb-2">
          <ConditionalProbabilityLollipopChart data={dmNafld} />
        </div>
      </section>

      {/* 二、分层对比：同心径向带 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold text-gray-900">糖尿病对脑卒中风险的影响差异</h2>
        <div className="mt-2">
          <StrokeRiskRadialBandsChart data={strokeByDm} />
        </div>
      </section>

      {/* 三、风险结构：构成型环形图 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold text-gray-900">不同疾病内部风险结构</h2>
        <div className="mt-2">
          <DiseaseInternalRiskStructureChart data={riskStruct} />
        </div>
      </section>

      {/* 四、因素贡献：雷达图 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold text-gray-900">每种疾病的核心驱动因素（Top 5）</h2>
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100/80 p-1 rounded-lg">
            {factors.map((f) => (
              <TabsTrigger
                key={f.disease}
                value={f.disease}
                className="text-xs sm:text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                {f.disease}
              </TabsTrigger>
            ))}
          </TabsList>
          {factors.map((f) => (
            <TabsContent key={f.disease} value={f.disease} className="mt-4">
              <FactorContributionRadarChart factors={f.factors} />
            </TabsContent>
          ))}
        </Tabs>
      </section>

      {/* 五、血糖分布：双序列面积图 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold text-gray-900">空腹血糖分布对比（糖尿病 vs 非糖尿病）</h2>
        <div className="mt-2">
          <GlucoseDistributionTwinAreaChart data={glucoseHist} />
        </div>
      </section>
    </div>
  );
}
