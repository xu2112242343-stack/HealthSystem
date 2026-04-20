import { deleteJson, getJson, postJson, putJson } from '@/lib/api';

export type AdminUserRow = {
  id: number;
  account: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  age: number | null;
  gender: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminUserListResponse = {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminUserDetail = AdminUserRow & {
  questionnaire: Record<string, unknown>;
};

export async function fetchAdminUsers(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminUserListResponse> {
  const search = new URLSearchParams();
  if (params.keyword) search.set('keyword', params.keyword);
  search.set('page', String(params.page ?? 1));
  search.set('pageSize', String(params.pageSize ?? 10));
  const raw = await getJson<unknown>(`/api/admin/users?${search.toString()}`);
  if (Array.isArray(raw)) {
    return {
      items: raw as AdminUserRow[],
      total: raw.length,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 10,
    };
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    items: Array.isArray(obj.items) ? (obj.items as AdminUserRow[]) : [],
    total: typeof obj.total === 'number' ? obj.total : 0,
    page: typeof obj.page === 'number' ? obj.page : (params.page ?? 1),
    pageSize: typeof obj.pageSize === 'number' ? obj.pageSize : (params.pageSize ?? 10),
  };
}

export async function fetchAdminUserDetail(id: number): Promise<AdminUserDetail> {
  return getJson<AdminUserDetail>(`/api/admin/users/${id}`);
}

export async function createAdminUser(body: {
  account: string;
  password: string;
  name?: string;
  phone?: string;
  email?: string;
}): Promise<{ ok: boolean; id: number }> {
  return postJson<{ ok: boolean; id: number }>('/api/admin/users', body);
}

export async function updateAdminUserStatus(id: number, active: boolean): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }>(`/api/admin/users/${id}/status`, { active });
}

export async function deleteAdminUser(id: number): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`/api/admin/users/${id}`);
}

export async function resetAdminUserPassword(id: number, newPassword: string): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }>(`/api/admin/users/${id}/reset-password`, {
    new_password: newPassword,
  });
}
