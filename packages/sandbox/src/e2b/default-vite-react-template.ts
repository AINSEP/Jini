/**
 * @file A starter Vite + React + Tailwind project, as plain file data.
 *
 * Purpose:
 * Ported from open-lovable's `E2BProvider.setupViteApp` — the same file contents, minus the
 * Python-heredoc plumbing that wrote them. That plumbing existed because open-lovable's E2B
 * usage wrote files by executing a Python script inside the sandbox; the real
 * `@e2b/code-interpreter` filesystem API this adapter uses (`files.write`) takes a plain string
 * directly; a caller mounts this template with one `session.mountFiles(DEFAULT_VITE_REACT_TEMPLATE)`
 * call and no code execution is needed to place it.
 *
 * Architectural role:
 * A convenience export, not part of the adapter's required surface. `SandboxProviderPort`/
 * `SandboxSession` know nothing about Vite, React, or Tailwind — see `core/ports.ts`'s doc
 * comment on why scaffolding a framework starter is a host-level concern, not the port's job.
 * This lives under `./e2b` (not `./core`) for that reason: it is something an E2B-backed host
 * may choose to use, not something every adapter must carry.
 */
import type { SandboxFile } from '../core/ports.js';

const PACKAGE_JSON = `{
  "name": "sandbox-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^4.3.9",
    "tailwindcss": "^3.3.0",
    "postcss": "^8.4.31",
    "autoprefixer": "^10.4.16"
  }
}
`;

const VITE_CONFIG = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    allowedHosts: ['.e2b.app', '.e2b.dev', 'localhost', '127.0.0.1']
  }
})
`;

const TAILWIND_CONFIG = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`;

const POSTCSS_CONFIG = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sandbox App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;

const MAIN_JSX = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`;

const APP_JSX = `function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="text-center max-w-2xl">
        <p className="text-lg text-gray-400">
          Sandbox Ready<br/>
          Start building your React app with Vite and Tailwind CSS!
        </p>
      </div>
    </div>
  )
}

export default App
`;

const INDEX_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background-color: rgb(17 24 39);
}
`;

/** Same starter app open-lovable's `setupViteApp` produces: a working Vite + React + Tailwind
 *  project with one placeholder screen, dropped in as data rather than assembled by a script
 *  running inside the sandbox. `allowedHosts` in `vite.config.js` intentionally omits
 *  `.vercel.run` (open-lovable supports Vercel Sandbox as a second backend; this package does
 *  not — see the README's three-adapter plan). */
export const DEFAULT_VITE_REACT_TEMPLATE: readonly SandboxFile[] = [
  { path: 'package.json', content: PACKAGE_JSON },
  { path: 'vite.config.js', content: VITE_CONFIG },
  { path: 'tailwind.config.js', content: TAILWIND_CONFIG },
  { path: 'postcss.config.js', content: POSTCSS_CONFIG },
  { path: 'index.html', content: INDEX_HTML },
  { path: 'src/main.jsx', content: MAIN_JSX },
  { path: 'src/App.jsx', content: APP_JSX },
  { path: 'src/index.css', content: INDEX_CSS },
];
