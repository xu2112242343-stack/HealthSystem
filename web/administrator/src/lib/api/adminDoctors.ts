import { deleteJson, getJson, postJson, putJson } from '@/lib/api';

export type AdminDoctorRow = {
  id: number;
  account: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  specialty: string | null;
  title: string | null;
  hospital: string | null;
  licenseCode: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminDoctorListResponse = {
  items: AdminDoctorRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function fetchAdminDoctors(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminDoctorListResponse> {
  const search = new URLSearchParams();
  if (params.keyword) search.set('keyword', params.keyword);
  search.set('page', String(params.page ?? 1));
  search.set('pageSize', String(params.pageSize ?? 10));
  const raw = await getJson<unknown>(`/api/admin/doctors?${search.toString()}`);
  if (Array.isArray(raw)) {
    return {
      items: raw as AdminDoctorRow[],
      total: raw.length,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 10,
    };
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    items: Array.isArray(obj.items) ? (obj.items as AdminDoctorRow[]) : [],
    total: typeof obj.total === 'number' ? obj.total : 0,
    page: typeof obj.page === 'number' ? obj.page : (params.page ?? 1),
    pageSize: typeof obj.pageSize === 'number' ? obj.pageSize : (params.pageSize ?? 10),
  };
}

export async function fetchAdminDoctorDetail(id: number): Promise<AdminDoctorRow> {
  return getJson<AdminDoctorRow>(`/api/admin/doctors/${id}`);
}

export async function createAdminDoctor(body: {
  account: string;
  password: string;
  license_code: string;
  name: string;
  phone?: string;
  email?: string;
  specialty?: string;
  title?: string;
  hospital?: string;
}): Promise<{ ok: boolean; id: number }> {
  return postJson<{ ok: boolean; id: number }>('/api/admin/doctors', body);
}

export async function updateAdminDoctor(
  id: number,
  body: {
    name?: string;
    phone?: string;
    email?: string;
    specialty?: string;
    title?: string;
    hospital?: string;
  },
): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }>(`/api/admin/doctors/${id}`, body);
}

export async function updateAdminDoctorStatus(id: number, active: boolean): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }>(`/api/admin/doctors/${id}/status`, { active });
}

export async function deleteAdminDoctor(id: number): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`/api/admin/doctors/${id}`);
}

export async function resetAdminDoctorPassword(id: number, newPassword: string): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }>(`/api/admin/doctors/${id}/reset-password`, {
    new_password: newPassword,
  });
}
