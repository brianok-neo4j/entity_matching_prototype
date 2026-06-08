import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: { '@main': resolve('src/main') }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: { '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()]
  }
})
