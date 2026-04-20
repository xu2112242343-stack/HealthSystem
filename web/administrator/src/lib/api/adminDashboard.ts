import { getJson } from '@/lib/api';

export type AdminDashboardOverviewResponse = {
  totals: {
    users: number;
    doctors: number;
    hospitals: number;
    articles: number;
  };
  registrationTrend: Array<{
    date: string;
    user: number;
    doctor: number;
  }>;
};

export type AdminActivityTodayResponse = {
  items: Array<{
    hour: string;
    users: number;
    doctors: number;
  }>;
};

export async function fetchAdminDashboardOverview(days = 7): Promise<AdminDashboardOverviewResponse> {
  const raw = await getJson<unknown>(`/api/admin/dashboard/overview?days=${days}`);
  if (!raw || typeof raw !== 'object') {
    throw new Error('管理员统计接口返回格式错误');
  }
  const obj = raw as Record<string, unknown>;
  const totals = obj.totals as Record<string, unknown> | undefined;
  const trend = obj.registrationTrend;
  if (
    !totals ||
    typeof totals.users !== 'number' ||
    typeof totals.doctors !== 'number' ||
    typeof totals.hospitals !== 'number' ||
    typeof totals.articles !== 'number' ||
    !Array.isArray(trend)
  ) {
    throw new Error('管理员统计接口返回字段不完整');
  }
  return raw as AdminDashboardOverviewResponse;
}

export async function fetchAdminActivityToday(): Promise<AdminActivityTodayResponse> {
  const raw = await getJson<unknown>('/api/admin/dashboard/activity-today');
  if (!raw || typeof raw !== 'object') {
    throw new Error('管理员活跃度接口返回格式错误');
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.items)) {
    throw new Error('管理员活跃度接口返回字段不完整');
  }
  return raw as AdminActivityTodayResponse;
}
