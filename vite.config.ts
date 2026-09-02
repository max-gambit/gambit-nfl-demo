import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // The legacy public directory contains dormant NBA-demo assets. Active NYG
  // assets are imported explicitly so production exports cannot copy them.
  publicDir: false,
  plugins: [blockLegacyNbaAssets(), react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
});

function blockLegacyNbaAssets(): Plugin {
  const legacyAsset = /^\/(?:public\/)?assets\/(?:hawks-logo\.svg|warriors-logo\.png|wizards-logo\.svg)(?:\?|$)/i;
  const install = (middlewares: { use(handler: (request: { url?: string }, response: { statusCode: number; end(): void }, next: () => void) => void): void }) => {
    middlewares.use((request, response, next) => {
      if (!legacyAsset.test(request.url ?? '')) return next();
      response.statusCode = 404;
      response.end();
    });
  };
  return {
    name: 'nyg-block-legacy-nba-assets',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}
