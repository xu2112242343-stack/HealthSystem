import { getJson } from '@/lib/api';

export type HealthRiskLevel = 'low' | 'medium' | 'high';

export type HealthHistorySnapshotSummary = {
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

export type HealthHistoryListResponse = {
  snapshots: HealthHistorySnapshotSummary[];
};

export type HealthHistoryIndicatorTrend = {
  x: string[]; // YYYY-MM-DD
  series: {
    fpg: Array<number | null>;
    hba1c: Array<number | null>;
    tg: Array<number | null>;
    sbp: Array<number | null>;
  };
};

export type HealthHistoryDetailResponse = {
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
  indicatorTrend: HealthHistoryIndicatorTrend;
  riskTrend: {
    liver: number[];
    diabetes: number[];
    stroke: number[];
  };
  reminderSuggestions: string[];
  doctorAdvice: string;
};

export async function fetchUserHealthHistoryList(): Promise<HealthHistoryListResponse> {
  return getJson<HealthHistoryListResponse>('/api/user/me/health-history');
}

export async function fetchUserHealthHistoryDetail(
  snapshotId: number,
): Promise<HealthHistoryDetailResponse> {
  return getJson<HealthHistoryDetailResponse>(`/api/user/me/health-history/${snapshotId}`);
}

