import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills() // This automatically adds Buffer, Global, Process
  ],
  define: {
    global: 'window', // Safety net
  }
})