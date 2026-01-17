import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['host.docker.internal'],
    port: 5173,
    host: true,
  },
})
