/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_API_MOCK?: string;
  readonly VITE_APP_NAME?: string;
  /** 设为 1 时管理端工作台与统计图使用演示数据（也可用地址栏 ?demo=1 或 ?demo1=1） */
  readonly VITE_ADMIN_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
