import { getJson, putJson } from '@/lib/api';

export type UserProfileResponse = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

/** GET /api/user/me/profile */
export async function fetchUserProfile(): Promise<UserProfileResponse> {
  return getJson<UserProfileResponse>('/api/user/me/profile');
}

/** PUT /api/user/me/profile */
export async function saveUserProfile(body: {
  name: string;
  phone: string;
  email: string;
  current_password?: string;
  new_password?: string;
}): Promise<{ ok: boolean }> {
  return putJson<{ ok: boolean }, Record<string, unknown>>('/api/user/me/profile', body);
}
