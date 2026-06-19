import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/mnemo/',
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/mnemo/api': {
        target: process.env.API_URL || 'http://localhost:8001',
        rewrite: (path) => path.replace(/^\/mnemo\/api/, ''),
      },
    },
  },
})
