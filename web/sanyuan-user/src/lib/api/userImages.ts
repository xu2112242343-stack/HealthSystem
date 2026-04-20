import { getApiBaseUrl, getAuthHeaders, getJson } from '@/lib/api';

export type UserAxis = 'liver' | 'diabetes' | 'stroke';

export type UserAxisImageMeta =
  | { exists: false }
  | {
      exists: true;
      axis: UserAxis;
      filename: string;
      mimeType: string;
      url: string;
    };

export async function fetchUserAxisImageMeta(axis: UserAxis): Promise<UserAxisImageMeta> {
  return getJson<UserAxisImageMeta>(`/api/user/me/images/${axis}/meta`);
}

export function userAxisImageAbsoluteUrl(axis: UserAxis): string {
  // 预览/下载二进制文件（需带 Authorization，img 标签不方便带 header，因此改用 fetch→blob）
  const base = getApiBaseUrl();
  return `${base}/api/user/me/images/${axis}`;
}

export async function uploadUserAxisImage(axis: UserAxis, file: File): Promise<{
  ok: boolean;
  axis: UserAxis;
  filename: string;
  mimeType: string;
  url: string;
}> {
  const base = getApiBaseUrl();
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch(`${base}/api/user/me/images/${axis}`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
    },
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || '上传失败');
  }
  return res.json();
}

export async function fetchUserAxisImageBlob(axis: UserAxis): Promise<Blob> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/user/me/images/${axis}`, {
    method: 'GET',
    headers: {
      ...getAuthHeaders(),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || '加载影像失败');
  }
  return res.blob();
}

export async function deleteUserAxisImage(axis: UserAxis): Promise<{ ok: boolean }> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/user/me/images/${axis}`, {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || '删除失败');
  }
  return res.json();
}

