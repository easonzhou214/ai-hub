import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'
import { ccSwitchPlugin } from './vite-plugins/cc-switch'
import { runtimePlugin } from './vite-plugins/runtime'
import { stateStorePlugin } from './vite-plugins/state-store'

export default defineConfig({
  // 版本号只在 package.json 里维护，界面与服务端 User-Agent 都读它，避免写死后漂移。
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    runtimePlugin(),
    ccSwitchPlugin(),
    stateStorePlugin(),
  ],
})
