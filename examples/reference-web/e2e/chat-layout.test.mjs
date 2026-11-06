/** Run with node --test in the browser CI host, which supplies Playwright and Chromium. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

async function openFixture(t, viewport) {
  const moduleName = 'playwright';
  const { chromium } = await import(moduleName);
  const server = await createServer({ configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    resolve: { dedupe: ['react', 'react-dom'] }, esbuild: { jsx: 'automatic' },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] } },
  });
  t.after(() => server.close());
  await server.listen();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport });
  await page.goto(`${server.resolvedUrls.local[0]}e2e/chat-layout.html`);
  await page.getByRole('button', { name: 'Open settings', exact: true }).waitFor();
  return page;
}

test('a long unbroken host header keeps the header and composer inside a 379px dock', async t => {
  const page = await openFixture(t, { width: 420, height: 800 });
  const boxes = await page.locator('.jini-chat-pane').evaluate(pane => {
    const rect = element => { const { left, right, width } = element.getBoundingClientRect(); return { left, right, width }; };
    return { pane: rect(pane), children: [...pane.children].map(rect) };
  });
  assert.equal(boxes.pane.width, 379);
  for (const box of boxes.children) {
    assert.ok(box.left >= boxes.pane.left && box.right <= boxes.pane.right + 1, `track ${JSON.stringify(box)} must fit dock ${JSON.stringify(boxes.pane)}`);
  }
});

test('the standalone settings stylesheet bounds scrolling, styles controls, and preserves focus at phone width', async t => {
  const page = await openFixture(t, { width: 390, height: 600 });
  // Read through the package export so the same test fails if published consumers cannot resolve it.
  const stylesheet = import.meta.resolve('@jini-ai/chat/react/styles/chat-settings.css');
  await page.addStyleTag({ content: await readFile(new URL(stylesheet), 'utf8') });
  await page.getByRole('button', { name: 'Open settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Chat settings' });
  const metrics = await dialog.evaluate(element => {
    const style = getComputedStyle(element), body = element.querySelector('.jini-chat-settings-body'), bodyStyle = getComputedStyle(body);
    const box = element.getBoundingClientRect(), group = element.querySelector('fieldset'), control = element.querySelector('.jini-chat-settings-segmented');
    return { left: box.left, right: box.right, bottom: box.bottom, border: style.borderTopWidth, groupBorder: getComputedStyle(group).borderTopWidth,
      controlBorder: getComputedStyle(control).borderTopWidth, overflow: bodyStyle.overflowY, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight };
  });
  assert.equal(metrics.border, '1px');
  assert.equal(metrics.groupBorder, '0px');
  assert.equal(metrics.controlBorder, '1px');
  assert.ok(metrics.left >= 0 && metrics.right <= 390 && metrics.bottom <= 600);
  assert.equal(metrics.overflow, 'auto');
  assert.ok(metrics.scrollHeight > metrics.clientHeight, 'only the settings body should scroll');
  const close = page.getByRole('button', { name: 'Close', exact: true });
  assert.equal(await close.evaluate(element => element === document.activeElement), true);
  assert.equal(await close.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Open settings', exact: true }).evaluate(element => element === document.activeElement), true);
});
