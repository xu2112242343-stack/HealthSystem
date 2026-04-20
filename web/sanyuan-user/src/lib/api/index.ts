/**
 * 用户端 API 入口：从此处 re-export，业务模块统一 `import { getJson, useApiMock } from '@/lib/api'`
 * 具体资源接口可拆分为 @/lib/api/xxx.ts
 */
export {
  ApiError,
  apiRequest,
  getJson,
  postJson,
  putJson,
  deleteJson,
  getStoredAccessToken,
  setStoredAccessToken,
  getAuthHeaders,
  decodeJwtPayload,
  getAccessTokenSubject,
  getAccessTokenAccount,
  ACCESS_TOKEN_CHANGED_EVENT,
  getApiBaseUrl,
  useApiMock,
  getClientAppLabel,
  type ApiRequestInit,
} from '@shared/api';
