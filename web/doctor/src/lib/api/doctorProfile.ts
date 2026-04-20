import { getJson, putJson } from '@/lib/api';

export type DoctorProfileResponse = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

export async function fetchDoctorProfile(): Promise<DoctorProfileResponse> {
  return getJson<DoctorProfileResponse>('/api/doctor/me/profile');
}

export async function saveDoctorProfile(body: {
  phone: string;
  email: string;
  current_password?: string;
  new_password?: string;
}): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }, Record<string, unknown>>('/api/doctor/me/profile', body);
}
