import { getJson } from '@/lib/api';

export type AppAccessResponse = {
  fullNavigation: boolean;
};

/** GET /api/user/me/app-access：是否已保存足够健康数据以解锁全站导航。 */
export async function fetchAppAccess(): Promise<AppAccessResponse> {
  return getJson<AppAccessResponse>('/api/user/me/app-access');
}
