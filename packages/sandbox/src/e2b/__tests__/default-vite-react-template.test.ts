import { describe, expect, it } from 'vitest';

import { DEFAULT_VITE_REACT_TEMPLATE } from '../default-vite-react-template.js';

describe('DEFAULT_VITE_REACT_TEMPLATE', () => {
  it('carries the files a Vite + React + Tailwind project needs to run', () => {
    const paths = DEFAULT_VITE_REACT_TEMPLATE.map((file) => file.path);
    expect(paths).toEqual([
      'package.json',
      'vite.config.js',
      'tailwind.config.js',
      'postcss.config.js',
      'index.html',
      'src/main.jsx',
      'src/App.jsx',
      'src/index.css',
    ]);
  });

  it('ships a package.json that is valid JSON with a working dev script', () => {
    const packageJsonFile = DEFAULT_VITE_REACT_TEMPLATE.find((file) => file.path === 'package.json');
    expect(packageJsonFile).toBeDefined();

    const parsed = JSON.parse(packageJsonFile!.content) as { scripts?: Record<string, string> };
    expect(parsed.scripts?.dev).toBe('vite --host');
  });

  it('is a SandboxFile[] usable directly as mountFiles input, not a template needing rendering', () => {
    // Real content, not a placeholder like `{{PLACEHOLDER}}` a caller would need to substitute —
    // this is what makes `session.mountFiles(DEFAULT_VITE_REACT_TEMPLATE)` work with no
    // intermediate step.
    for (const file of DEFAULT_VITE_REACT_TEMPLATE) {
      expect(file.content.length).toBeGreaterThan(0);
      expect(file.content).not.toMatch(/\{\{.*\}\}/);
    }
  });
});
