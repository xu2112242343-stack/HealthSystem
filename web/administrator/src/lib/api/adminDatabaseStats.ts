import { getJson } from '@/lib/api';

export type AdminDatabaseStatsResponse = {
  healthArticlesByDisease: Array<{ name: string; value: number }>;
  hospitalsByLevel: Array<{ name: string; value: number }>;
  trend: Array<{ date: string; articles: number; hospitals: number }>;
};

export async function fetchAdminDatabaseStats(days = 30): Promise<AdminDatabaseStatsResponse> {
  const raw = await getJson<unknown>(`/api/admin/database/stats?days=${days}`);
  if (!raw || typeof raw !== 'object') throw new Error('医疗数据库统计接口返回格式错误');
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.healthArticlesByDisease) || !Array.isArray(obj.hospitalsByLevel) || !Array.isArray(obj.trend)) {
    throw new Error('医疗数据库统计接口返回字段不完整');
  }
  return raw as AdminDatabaseStatsResponse;
}

