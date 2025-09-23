import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/talk': 'http://localhost:8000',
      '/transcribe': 'http://localhost:8000',
      '/chat': 'http://localhost:8000',
      '/speak': 'http://localhost:8000'
    }
  }
}) 