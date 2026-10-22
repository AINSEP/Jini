import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import * as core from '../index.js';
import { createHtmlRegionTarget, isValidRegionHandle, type HtmlDocumentStore } from '../html/index.js';
import { createParse5RegionParser } from '../html/node/index.js';
import {
  createVibecodingSession,
  createVibecodingToolRegistrations,
  createVibecodingToolRunner,
  VIBECODING_TOOL_IDS,
  type VibecodingSessionArgs,
  type VibecodingSessionOptions,
  type VibecodingToolArgs,
  type UseVibecodingSessionArgs,
} from '../react/index.js';

describe('package integration', () => {
  test('all published entry points have matching runtime metadata and source barrels', () => {
    const packageRoot = new URL('../../', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
      exports: Record<string, { types: string; import: string; default: string }>;
      jini: { entries: Record<string, string> };
    };
    expect(manifest.jini.entries).toEqual({
      '.': 'universal', './core': 'universal', './html': 'universal',
      './html/node': 'node', './react': 'browser',
    });
    expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
    for (const [entry, conditions] of Object.entries(manifest.exports)) {
      const stem = entry === '.' ? 'index' : `${entry.slice(2)}/index`;
      expect(conditions).toEqual({
        types: `./dist/${stem}.d.ts`, import: `./dist/${stem}.js`, default: `./dist/${stem}.js`,
      });
      expect(existsSync(new URL(`src/${stem}.ts`, packageRoot))).toBe(true);
    }
  });



  test('HTML storage, core history, session and tool barrels compose with object arguments', async () => {
    const initial = '<section data-agent-element="hero">old</section>';
    let html = initial;
    const store: HtmlDocumentStore = {
      read: async () => html,
      write: async ({ html: next }) => { html = next; },
    };
    const target = createHtmlRegionTarget({ store, parser: createParse5RegionParser() }, { maxPartLength: 100 });
    const args: VibecodingSessionArgs = { target };
    const options: VibecodingSessionOptions = { historyOptions: { limit: 5 } };
    const session = createVibecodingSession(args, options);
    const toolArgs: VibecodingToolArgs = { session };
    const hookArgs: UseVibecodingSessionArgs = toolArgs;
    expect(hookArgs.session).toBe(session);
    const runner = createVibecodingToolRunner(toolArgs);
    const registrations = createVibecodingToolRegistrations(toolArgs, { policy: { authorize: () => 'deny' } });
    expect(registrations.map(({ descriptor }) => descriptor.id)).toEqual(runner.descriptors.map(({ id }) => id));
    expect(isValidRegionHandle({ handle: 'hero' })).toBe(true);
    expect(await runner.run({ toolId: VIBECODING_TOOL_IDS.READ_PART, input: { id: 'hero' } }))
      .toEqual({ id: 'hero', content: 'old' });
    const snapshot = await session.takeSnapshot();

    expect(await runner.run({ toolId: VIBECODING_TOOL_IDS.PROPOSE_EDITS, input: {
      edits: [{ id: 'hero', content: 'new' }], label: 'chat turn',
    } })).toEqual({ outcomes: [{ status: 'applied', id: 'hero' }], corrections: [] });
    expect(html).toBe('<section data-agent-element="hero">new</section>');
    expect(session.history.entries()[0]?.label).toBe('chat turn');
    await runner.run({ toolId: VIBECODING_TOOL_IDS.UNDO, input: {} });
    expect(html).toBe(initial);
    await runner.run({ toolId: VIBECODING_TOOL_IDS.REDO, input: {} });
    expect(html).toBe('<section data-agent-element="hero">new</section>');
    await session.restoreSnapshot({ snapshot });
    expect(html).toBe(initial);

    const outcomes = await core.applyEdits({ target, edits: [{ id: 'hero', content: 'direct' }] });
    expect(core.correctionsFor({ outcomes })).toEqual([]);
    expect(await target.readPart({ id: 'hero' })).toBe('direct');
  });
});
