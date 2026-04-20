/**
 * 管理端 API 入口；具体模块可新增 @/lib/api/*.ts 并在此按需导出
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
  getApiBaseUrl,
  useApiMock,
  getClientAppLabel,
  type ApiRequestInit,
} from '@shared/api';
