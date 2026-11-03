/** Run with node --test in the browser CI host, which supplies Playwright and Chromium. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Send and Stop receive real coordinate clicks beside the effort selector at 320px dock width', async t => {
  const moduleName = 'playwright';
  const { chromium } = await import(moduleName);
  const server = await createServer({ configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    resolve: { dedupe: ['react', 'react-dom'] },
    esbuild: { jsx: 'automatic' },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] } },
  });
  t.after(() => server.close());
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 360, height: 900 } });
  await page.goto(`${server.resolvedUrls.local[0]}e2e/composer-hit-targets.html`);
  for (const [label, output] of [['Send', 'sent'], ['Stop run', 'stopped']]) {
    const action = page.getByRole('button', { name: label, exact: true });
    await action.waitFor({ state: 'visible' });
    const point = await action.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      return { x, y, receivesClick: button.contains(document.elementFromPoint(x, y)) };
    });
    assert.equal(point.receivesClick, true, `${label} centre must hit the action, not an overlapping control`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(id => document.getElementById(id)?.textContent === '1', output);
    assert.equal(await page.getByRole('button', { name: 'Reasoning: Default', exact: true }).first().getAttribute('aria-expanded'), 'false');
  }
});
