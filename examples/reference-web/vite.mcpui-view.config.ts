import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Builds `mcpui-view-src/mcp-app.ts` (the real `@modelcontextprotocol/ext-apps` `App`-based View)
 * into ONE self-contained HTML file at `dist-mcpui-view/mcp-app.html` — `daemon.ts`'s
 * `/mcpui-lab/view` route reads and serves that build output directly, over its own port (a
 * genuinely different origin than the Vite dev server serving the Host page).
 *
 * Separate config, separate `vite build` invocation (see `package.json`'s `build`/
 * `build:mcpui-view` scripts) rather than folding this into the main `vite.config.ts`: the main
 * config's dev server needs to keep serving `index.html` at the app's root for HMR, and mixing a
 * `singlefile`-bundled second entry into that same dev server would either put the View on the
 * SAME origin as the Host (defeating the whole point) or require its own dev-server instance
 * anyway — a one-shot build the daemon serves as a static file is simpler and matches how a real
 * MCP App server ships its View (see the official SDK's own examples, which build this way).
 */
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-mcpui-view',
    emptyOutDir: true,
    rollupOptions: {
      input: 'mcpui-view-src/mcp-app.html',
    },
  },
});
