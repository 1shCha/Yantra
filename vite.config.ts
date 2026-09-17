import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { uiRenderProbePlugin } from './tools/ui-render-probe-plugin';

export default defineConfig(({ command, mode }) => ({
  define: { __VAULT_DIAGNOSTICS__: JSON.stringify(command === 'serve') },
  base: './',
  plugins: [...(mode === 'ui-regressions' ? [uiRenderProbePlugin()] : []), react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
}));
