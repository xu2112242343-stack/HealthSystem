import { getJson } from '@/lib/api';
import { getDemoDiseaseAnalysisDashboard, isDoctorDemoMode } from '@/lib/doctorDemoMock';
import {
  chartDmGivenNafld,
  chartFactorImportance,
  chartGlucoseDistribution,
  chartRiskStructure,
  chartStrokeRiskByDm,
} from '@/app/components/diseaseAnalysisCharts';

/**
 * 与后端约定：疾病分析页一次拉取的图表 bundle（可减少往返）。
 * 若后端只返回原始 cohort，可改为在前端用 chartXxx 计算，或单独增加聚合接口。
 */
/** 与后端 dashboard 接口 meta 对齐：登记总人数 vs 实际参与聚合的人数 */
export type DiseaseAnalysisDashboardMeta = {
  totalRegisteredPatients: number;
  analyzedPatients: number;
  /** 请求参数；0 表示不限制（全员） */
  cohortSizeRequested: number;
};

export type DiseaseAnalysisDashboard = {
  /** 传播分顺序：[糖尿病→脂肪肝, 脂肪肝→脑卒中, 糖尿病→脑卒中]（与用户端图示一致） */
  propagationScores: readonly [number, number, number];
  overallRiskDist: { low: number; mid: number; high: number };
  comorbidityRegions: Record<'1' | '2' | '3' | '12' | '13' | '23' | '123', number>;
  dmNafld: ReturnType<typeof chartDmGivenNafld>;
  strokeByDm: ReturnType<typeof chartStrokeRiskByDm>;
  riskStruct: ReturnType<typeof chartRiskStructure>;
  factors: ReturnType<typeof chartFactorImportance>;
  glucoseHist: ReturnType<typeof chartGlucoseDistribution>;
  meta?: DiseaseAnalysisDashboardMeta;
};

/** cohortSize<=0 或不传：分析全部已登记患者；>0 时仅取最近 N 人（id 倒序） */
const DASHBOARD_TIMEOUT_MS = 60_000;

/** 短时内存缓存：切换子页再回来可减少一次等待（医生端单页内有效） */
let dashboardCache: {
  cohortSize: number;
  data: DiseaseAnalysisDashboard;
  fetchedAt: number;
} | null = null;
const DASHBOARD_CACHE_MS = 45_000;

/** 下一次请求带 refresh=1，绕过服务端 12s 内存缓存（重试 / 强制刷新用） */
let bustServerDashboardCache = false;

export function invalidateDiseaseAnalysisDashboardCache(): void {
  dashboardCache = null;
  bustServerDashboardCache = true;
}

export async function fetchDiseaseAnalysisDashboard(cohortSize = 0): Promise<DiseaseAnalysisDashboard> {
  if (isDoctorDemoMode()) {
    const data = getDemoDiseaseAnalysisDashboard(cohortSize);
    dashboardCache = { cohortSize, data, fetchedAt: Date.now() };
    return data;
  }

  const now = Date.now();
  const refresh = bustServerDashboardCache;
  if (bustServerDashboardCache) bustServerDashboardCache = false;

  if (
    !refresh &&
    dashboardCache &&
    dashboardCache.cohortSize === cohortSize &&
    now - dashboardCache.fetchedAt < DASHBOARD_CACHE_MS
  ) {
    return dashboardCache.data;
  }

  const qs = new URLSearchParams();
  qs.set('cohortSize', String(cohortSize));
  if (refresh) qs.set('refresh', '1');

  const data = await getJson<DiseaseAnalysisDashboard>(
    `/api/doctor/disease-analysis/dashboard?${qs.toString()}`,
    { timeoutMs: DASHBOARD_TIMEOUT_MS },
  );
  dashboardCache = { cohortSize, data, fetchedAt: Date.now() };
  return data;
}
