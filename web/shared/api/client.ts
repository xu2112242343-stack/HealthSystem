import { getApiBaseUrl, getClientAppLabel } from '../env/public';
import { getAuthHeaders } from './auth';
import { ApiError } from './types';

const DEFAULT_TIMEOUT_MS = 25_000;

function joinUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}

export type ApiRequestInit = RequestInit & { timeoutMs?: number };

export async function apiRequest(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers: hdrInit, ...rest } = init;
  const url = joinUrl(getApiBaseUrl(), path);
  const controller = new AbortController();
  const tid = window.setTimeout(() => {
    // 无参 abort() 在部分运行时会得到「signal is aborted without reason」，用户难以理解
    controller.abort(
      new DOMException(`请求超时（${Math.round(timeoutMs / 1000)} 秒内无响应）`, 'TimeoutError'),
    );
  }, timeoutMs);
  try {
    const headers = new Headers(hdrInit);
    const auth = getAuthHeaders();
    for (const [k, v] of Object.entries(auth)) {
      if (v && !headers.has(k)) headers.set(k, v);
    }
    headers.set('X-Client-App', getClientAppLabel());
    if (
      rest.body != null &&
      !(rest.body instanceof FormData) &&
      !headers.has('Content-Type') &&
      typeof rest.body === 'string'
    ) {
      headers.set('Content-Type', 'application/json');
    }
    return await fetch(url, {
      ...rest,
      headers,
      signal: controller.signal,
      credentials: 'include',
      /** 避免 GET（如 /api/user/me/questionnaire）因 URL 相同被缓存成「上一用户的 JSON」；Authorization 默认不参与缓存键。 */
      cache: 'no-store',
    });
  } finally {
    clearTimeout(tid);
  }
}

async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const o = body as Record<string, unknown>;
  if (typeof o.message === 'string' && o.message.trim()) return o.message;
  const d = o.detail;
  if (typeof d === 'string' && d.trim()) return d;
  if (Array.isArray(d) && d.length > 0) {
    const first = d[0] as Record<string, unknown>;
    if (typeof first.msg === 'string' && first.msg.trim()) return first.msg;
  }
  return fallback;
}

export async function getJson<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const res = await apiRequest(path, { ...init, method: 'GET' });
  const body = await parseJsonBody(res);
  if (!res.ok) {
    throw new ApiError(
      messageFromBody(body, res.statusText || `HTTP ${res.status}`),
      res.status,
      body,
    );
  }
  return body as T;
}

export async function postJson<T, B = unknown>(path: string, body: B, init?: ApiRequestInit): Promise<T> {
  const res = await apiRequest(path, {
    ...init,
    method: 'POST',
    body: JSON.stringify(body),
  });
  const parsed = await parseJsonBody(res);
  if (!res.ok) {
    throw new ApiError(
      messageFromBody(parsed, res.statusText || `HTTP ${res.status}`),
      res.status,
      parsed,
    );
  }
  return parsed as T;
}

export async function putJson<T, B = unknown>(path: string, body: B, init?: ApiRequestInit): Promise<T> {
  const res = await apiRequest(path, {
    ...init,
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const parsed = await parseJsonBody(res);
  if (!res.ok) {
    throw new ApiError(
      messageFromBody(parsed, res.statusText || `HTTP ${res.status}`),
      res.status,
      parsed,
    );
  }
  return parsed as T;
}

export async function deleteJson<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const res = await apiRequest(path, { ...init, method: 'DELETE' });
  const parsed = await parseJsonBody(res);
  if (!res.ok) {
    throw new ApiError(
      messageFromBody(parsed, res.statusText || `HTTP ${res.status}`),
      res.status,
      parsed,
    );
  }
  return parsed as T;
}
