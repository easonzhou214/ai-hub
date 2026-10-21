import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ccSwitchPlugin } from './vite-plugins/cc-switch'

export default defineConfig({
  plugins: [react(), ccSwitchPlugin()],
})
