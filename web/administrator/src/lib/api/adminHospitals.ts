import { deleteJson, getJson, postJson, putJson } from '@/lib/api';

export type AdminHospitalRow = {
  id: number;
  name: string;
  level: string;
  address: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  department: string;
  departments: string;
  specialties: string;
  workingHours: string;
  rating: number | null;
  experts: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminHospitalListResponse = {
  items: AdminHospitalRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function fetchAdminHospitals(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminHospitalListResponse> {
  const search = new URLSearchParams();
  if (params.keyword) search.set('keyword', params.keyword);
  search.set('page', String(params.page ?? 1));
  search.set('pageSize', String(params.pageSize ?? 10));
  const raw = await getJson<unknown>(`/api/admin/hospitals?${search.toString()}`);
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    items: Array.isArray(obj.items) ? (obj.items as AdminHospitalRow[]) : [],
    total: typeof obj.total === 'number' ? obj.total : 0,
    page: typeof obj.page === 'number' ? obj.page : (params.page ?? 1),
    pageSize: typeof obj.pageSize === 'number' ? obj.pageSize : (params.pageSize ?? 10),
  };
}

export async function createAdminHospital(body: {
  name: string;
  level?: string;
  address: string;
  phone: string;
  latitude?: number | null;
  longitude?: number | null;
  department?: string;
  departments?: string;
  specialties?: string;
  working_hours?: string;
  rating?: number | null;
  experts?: number | null;
  is_active?: boolean;
}): Promise<{ ok: boolean; id: number }> {
  return postJson<{ ok: boolean; id: number }>('/api/admin/hospitals', body);
}

export async function updateAdminHospital(
  id: number,
  body: {
    name: string;
    level?: string;
    address: string;
    phone: string;
    latitude?: number | null;
    longitude?: number | null;
    department?: string;
    departments?: string;
    specialties?: string;
    working_hours?: string;
    rating?: number | null;
    experts?: number | null;
    is_active?: boolean;
  },
): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }>(`/api/admin/hospitals/${id}`, body);
}

export async function deleteAdminHospital(id: number): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`/api/admin/hospitals/${id}`);
}

