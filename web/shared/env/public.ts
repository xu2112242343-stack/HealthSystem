/// <reference types="vite/client" />

/** 后端 API 根路径，如 https://api.example.com 或留空走同源 + 反向代理 */
export function getApiBaseUrl(): string {
  const v = import.meta.env.VITE_API_BASE_URL;
  return typeof v === 'string' ? v.replace(/\/$/, '') : '';
}

/**
 * 默认 true：开发期走本地 mock；接入真实 API 后在 .env 中设置 VITE_USE_API_MOCK=false
 */
export function useApiMock(): boolean {
  const v = import.meta.env.VITE_USE_API_MOCK;
  if (v === 'false' || v === '0') return false;
  return true;
}

/** 随请求头 X-Client-App 发送，便于后端区分子应用 */
export function getClientAppLabel(): string {
  const v = import.meta.env.VITE_APP_NAME;
  return typeof v === 'string' && v.trim() ? v.trim() : 'web';
}
