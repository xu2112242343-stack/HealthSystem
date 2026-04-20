import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8001',
    changeOrigin: true,
  },
} as const

export default defineConfig({
  server: {
    port: 5171,
    strictPort: true,
    /** 开发时若未设置 VITE_API_BASE_URL，相对路径 /api/* 会打到此处并转发到 FastAPI */
    proxy: { ...apiProxy },
  },
  /** npm run preview 时同样需要代理，否则 /api 会 404（端口默认 4173，避免与 dev 5171 冲突） */
  preview: {
    proxy: { ...apiProxy },
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
})
