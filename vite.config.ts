import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@geometry': path.resolve(process.cwd(), 'src/geometry'),
      '@state': path.resolve(process.cwd(), 'src/state'),
      '@canvas': path.resolve(process.cwd(), 'src/canvas'),
      '@ui': path.resolve(process.cwd(), 'src/ui'),
      '@utils': path.resolve(process.cwd(), 'src/utils'),
      '@types': path.resolve(process.cwd(), 'src/types.ts'),
    },
  },
})
