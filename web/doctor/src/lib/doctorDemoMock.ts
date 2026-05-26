/**
 * 医生端工作台演示数据（与管理端 PLATFORM_DEMO_* 对齐）。
 */
import type { DiseaseAnalysisDashboard } from '@/lib/api/diseaseAnalysisDashboard';
import {
  PLATFORM_DEMO_COMORBIDITY,
  PLATFORM_DEMO_OVERALL_RISK,
  PLATFORM_DEMO_PATIENT_COHORT,
  PLATFORM_DEMO_TOTALS,
  isPlatformDemoMode,
} from '@shared/demo/platformDemo';
import {
  buildDiseaseCohort,
  chartDmGivenNafld,
  chartFactorImportance,
  chartGlucoseDistribution,
  chartRiskStructure,
  chartStrokeRiskByDm,
} from '@/app/components/diseaseAnalysisCharts';

export function isDoctorDemoMode(): boolean {
  return isPlatformDemoMode();
}

export function getDemoDiseaseAnalysisDashboard(cohortSizeRequested = 0): DiseaseAnalysisDashboard {
  const n = PLATFORM_DEMO_PATIENT_COHORT;
  const rows = buildDiseaseCohort(n);
  return {
    propagationScores: [56, 44, 48],
    overallRiskDist: { ...PLATFORM_DEMO_OVERALL_RISK },
    comorbidityRegions: { ...PLATFORM_DEMO_COMORBIDITY },
    dmNafld: chartDmGivenNafld(rows),
    strokeByDm: chartStrokeRiskByDm(rows),
    riskStruct: chartRiskStructure(rows),
    factors: chartFactorImportance(),
    glucoseHist: chartGlucoseDistribution(rows),
    meta: {
      totalRegisteredPatients: PLATFORM_DEMO_TOTALS.users,
      analyzedPatients: n,
      cohortSizeRequested,
    },
  };
}
