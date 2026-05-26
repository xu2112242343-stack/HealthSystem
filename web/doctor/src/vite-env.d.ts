/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_API_MOCK?: string;
  /** 设为 1 时工作台使用演示数据（与管理端一致；也可用 ?demo=1） */
  readonly VITE_DOCTOR_DEMO?: string;
  readonly VITE_ADMIN_DEMO?: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
