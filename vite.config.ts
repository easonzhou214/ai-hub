import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ccSwitchPlugin } from './vite-plugins/cc-switch'
import { stateStorePlugin } from './vite-plugins/state-store'

export default defineConfig({
  plugins: [react(), ccSwitchPlugin(), stateStorePlugin()],
})
