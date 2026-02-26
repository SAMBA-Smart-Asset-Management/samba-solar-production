import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/main.jsx',
      name: 'SolarProductionPanel',
      formats: ['iife'],
      fileName: () => 'solar-production-panel.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
    minify: 'terser',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
