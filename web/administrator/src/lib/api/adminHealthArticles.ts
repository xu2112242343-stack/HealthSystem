import { deleteJson, getJson, postJson, putJson } from '@/lib/api';

export type AdminHealthArticleRow = {
  id: number;
  title: string;
  summary: string;
  content: string;
  disease: string;
  type: string;
  tags: string;
  risk_level: string;
  source: string;
  /** false 时仅参与后台统计，用户端「健康生活指南」不展示 */
  show_in_health_guide?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminHealthArticleListResponse = {
  items: AdminHealthArticleRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function fetchAdminHealthArticles(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminHealthArticleListResponse> {
  const search = new URLSearchParams();
  if (params.keyword) search.set('keyword', params.keyword);
  search.set('page', String(params.page ?? 1));
  search.set('pageSize', String(params.pageSize ?? 10));
  const raw = await getJson<unknown>(`/api/admin/health-articles?${search.toString()}`);
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    items: Array.isArray(obj.items) ? (obj.items as AdminHealthArticleRow[]) : [],
    total: typeof obj.total === 'number' ? obj.total : 0,
    page: typeof obj.page === 'number' ? obj.page : (params.page ?? 1),
    pageSize: typeof obj.pageSize === 'number' ? obj.pageSize : (params.pageSize ?? 10),
  };
}

export async function createAdminHealthArticle(body: {
  id: number;
  title: string;
  summary: string;
  content: string;
  disease: string;
  type: string;
  tags?: string;
  risk_level?: string;
  source?: string;
  show_in_health_guide?: boolean;
}): Promise<{ ok: boolean; id: number }> {
  return postJson<{ ok: boolean; id: number }>('/api/admin/health-articles', body);
}

export async function updateAdminHealthArticle(
  id: number,
  body: {
    id: number;
    title: string;
    summary: string;
    content: string;
    disease: string;
    type: string;
    tags?: string;
    risk_level?: string;
    source?: string;
    show_in_health_guide?: boolean;
  },
): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }>(`/api/admin/health-articles/${id}`, body);
}

export async function deleteAdminHealthArticle(id: number): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`/api/admin/health-articles/${id}`);
}

