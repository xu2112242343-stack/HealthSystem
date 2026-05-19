import { getJson, putJson } from '@/lib/api';

export type HealthRiskLevel = 'low' | 'medium' | 'high';

export type DoctorFollowupMetricsResponse = {
  meta: {
    now: string;
    graceDays: number;
    totalDueEvents: number;
  };
  rates: {
    followUpRate: number;
    lossRate: number;
    revisited: number;
    lost: number;
    onTime: number;
    late: number;
  };
  distribution: {
    onTime: number;
    late: number;
    lost: number;
  };
};

export type DoctorHealthHistorySnapshotSummary = {
  id: number;
  snapshotAt: string;
  nextReviewDate: string;
  remainingDays: number | null;
  isOverdue: boolean;
  maxRisk: {
    level: HealthRiskLevel;
    label: string;
    probability: number;
  };
  probabilities: {
    liver: number;
    diabetes: number;
    stroke: number;
  };
  riskLevels: {
    liver: HealthRiskLevel | string;
    diabetes: HealthRiskLevel | string;
    stroke: HealthRiskLevel | string;
  };
};

export type DoctorHealthHistoryListResponse = {
  patientId: number;
  snapshots: DoctorHealthHistorySnapshotSummary[];
};

export type DoctorHealthHistoryIndicatorTrend = {
  x: string[];
  series: {
    fpg: Array<number | null>;
    hba1c: Array<number | null>;
    tg: Array<number | null>;
    sbp: Array<number | null>;
  };
};

export type DoctorHealthHistoryDetailResponse = {
  id: number;
  snapshotAt: string;
  payload: any;
  probabilities: {
    liver: number;
    diabetes: number;
    stroke: number;
  };
  riskLevels: {
    liver: string;
    diabetes: string;
    stroke: string;
  };
  followUpPlan: {
    nextReviewDate: string;
    remainingDays: number;
    intervalDays: number;
    scheduleLevel: HealthRiskLevel | string;
    scheduleLabel: string;
  };
  indicatorTrend: DoctorHealthHistoryIndicatorTrend;
  riskTrend: {
    liver: number[];
    diabetes: number[];
    stroke: number[];
  };
  reminderSuggestions: string[];
  doctorAdvice: string;
};

export type DoctorPatientRow = {
  id: string; // 后端返回为字符串（见 _user_to_questionnaire_row）
  name: string;
  patientNo: string;
  updatedAt: string;
  age?: number;
  gender?: string;
  heightCm?: number;
  weightKg?: number;
  waistCm?: number;
  sbp?: number;
  dbp?: number;
  fpg?: number;
  hba1c?: number;
  tg?: number;
  tc?: number;
  hdl?: number;
  ldl?: number;
  alt?: number;
  ast?: number;
  ggt?: number;
  uricAcid?: number;
  [key: string]: unknown;
};

export async function fetchDoctorPatientsQuestionnaires(): Promise<DoctorPatientRow[]> {
  return getJson<DoctorPatientRow[]>('/api/doctor/patients/questionnaires');
}

export async function fetchDoctorFollowupMetrics(graceDays = 30): Promise<DoctorFollowupMetricsResponse> {
  const qs = new URLSearchParams({ graceDays: String(graceDays) });
  return getJson<DoctorFollowupMetricsResponse>(`/api/doctor/followup/metrics?${qs.toString()}`);
}

export async function fetchDoctorPatientHealthHistoryList(
  patientId: number,
): Promise<DoctorHealthHistoryListResponse> {
  return getJson<DoctorHealthHistoryListResponse>(`/api/doctor/patients/${patientId}/health-history`);
}

export async function fetchDoctorPatientHealthHistoryDetail(
  patientId: number,
  snapshotId: number,
): Promise<DoctorHealthHistoryDetailResponse> {
  return getJson<DoctorHealthHistoryDetailResponse>(
    `/api/doctor/patients/${patientId}/health-history/${snapshotId}`,
  );
}

export async function updateDoctorPatientHealthHistoryAdvice(
  patientId: number,
  snapshotId: number,
  doctorAdvice: string,
): Promise<{ ok: boolean; doctorAdvice: string }> {
  return putJson<{ ok: boolean; doctorAdvice: string }>(
    `/api/doctor/patients/${patientId}/health-history/${snapshotId}/advice`,
    { doctorAdvice },
  );
}

