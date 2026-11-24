/**
 * @file A host's overlay for portable Agent Plugins, over a real temp overlays directory: lookup
 * rules (id-only, bounded, no traversal), the two delivery seams, and the chat-host Bash filter.
 * The frontmatter check uses the package's own failsafe YAML reader.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentPluginDeliveryMode } from '@jini-ai/agent-plugins/lifecycle';
import {
  deliverHostPluginGuidance,
  isHostPluginFileRequest,
  MAX_HOST_PLUGIN_FILE_BYTES,
  readHostPluginFile,
  readHostPluginGuidance,
  readHostPluginRefOverlays,
  removeChatRefusedToolPermissions,
  splitHostPluginRefRequest,
} from '../host-plugin-guidance.js';

let overlaysDir: string;
const put = (relative: string, content: string | Buffer) => {
  const target = path.join(overlaysDir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};

beforeAll(() => {
  overlaysDir = mkdtempSync(path.join(os.tmpdir(), 'host-plugin-guidance-'));
  put('shadcn/GUIDANCE.md', 'Host rule: use site_write.');
  put('shadcn/host/zeta.md', 'zeta text');
  put('shadcn/host/alpha.md', 'alpha text');
  put('shadcn/host/Bad.md', 'uppercase is not a valid host file name');
  put('shadcn/host/under_score.md', 'underscore is not a valid host file name');
  put('shadcn/host/notes.txt', 'not markdown');
  put('shadcn/host/nested/inner.md', 'directories are never listed');
  put('onlyfiles/host/one.md', 'one');
  put('big/GUIDANCE.md', Buffer.alloc(MAX_HOST_PLUGIN_FILE_BYTES + 1, 97));
  put('exact/GUIDANCE.md', Buffer.alloc(MAX_HOST_PLUGIN_FILE_BYTES, 97));
  put('bigfile/host/huge.md', Buffer.alloc(MAX_HOST_PLUGIN_FILE_BYTES + 1, 97));
  mkdirSync(path.join(overlaysDir, 'dirguide/GUIDANCE.md'), { recursive: true });
});
afterAll(() => rmSync(overlaysDir, { recursive: true, force: true }));

describe('isHostPluginFileRequest', () => {
  it('is true only for a text value under the host/ prefix', () => {
    expect(isHostPluginFileRequest({ file: 'host/alpha.md' })).toBe(true);
    for (const file of ['alpha.md', 'Host/alpha.md', '', undefined, 5, null, ['host/a.md']]) expect(isHostPluginFileRequest({ file })).toBe(false);
  });
});

describe('readHostPluginGuidance', () => {
  it('returns the guidance and the sorted, valid host file names', async () => {
    expect(await readHostPluginGuidance({ pluginId: 'shadcn', overlaysDir })).toEqual({ guidance: 'Host rule: use site_write.', files: ['host/alpha.md', 'host/zeta.md'] });
  });

  it('works with only host files, and with no overlay at all', async () => {
    expect(await readHostPluginGuidance({ pluginId: 'onlyfiles', overlaysDir })).toEqual({ files: ['host/one.md'] });
    expect(await readHostPluginGuidance({ pluginId: 'nothing-here', overlaysDir })).toEqual({ files: [] });
  });

  it.each(['../shadcn', 'shadcn/..', 'Shadcn', 'a/b', '-shadcn', '', 'shad.cn', 'shadcn\\x'])('returns no overlay for the id %j, which cannot name one', async (pluginId) => {
    expect(await readHostPluginGuidance({ pluginId, overlaysDir })).toEqual({ files: [] });
  });

  it('accepts a guidance file of exactly the cap, and refuses one byte over it rather than silently dropping host rules', async () => {
    expect((await readHostPluginGuidance({ pluginId: 'exact', overlaysDir })).guidance).toHaveLength(MAX_HOST_PLUGIN_FILE_BYTES);
    await expect(readHostPluginGuidance({ pluginId: 'big', overlaysDir })).rejects.toThrow(`Agent Plugin overlay big/GUIDANCE.md is over ${MAX_HOST_PLUGIN_FILE_BYTES} bytes`);
  });

  it('throws when GUIDANCE.md is not a file: a broken overlay is never read as absent', async () => {
    await expect(readHostPluginGuidance({ pluginId: 'dirguide', overlaysDir })).rejects.toThrow('Agent Plugin overlay entry is not a file: GUIDANCE.md');
  });
});

describe('readHostPluginFile', () => {
  it('reads a listed host file', async () => {
    expect(await readHostPluginFile({ pluginId: 'shadcn', file: 'host/alpha.md', overlaysDir })).toEqual({ text: 'alpha text' });
  });

  it('answers a well-formed but absent name with a note naming the valid files', async () => {
    expect(await readHostPluginFile({ pluginId: 'shadcn', file: 'host/missing.md', overlaysDir })).toEqual({
      note: "Host file 'host/missing.md' is not available for the 'shadcn' plugin. Valid host files: host/alpha.md, host/zeta.md." });
  });

  it('never echoes or follows an unsafe name, and never lists files for an id that cannot name an overlay', async () => {
    const traversal = await readHostPluginFile({ pluginId: 'shadcn', file: 'host/../GUIDANCE.md', overlaysDir });
    expect(traversal).toEqual({ note: "Host file is not available for the 'shadcn' plugin. Valid host files: host/alpha.md, host/zeta.md." });
    expect(JSON.stringify(traversal)).not.toContain('..');
    expect(await readHostPluginFile({ pluginId: '../shadcn', file: 'host/alpha.md', overlaysDir })).toEqual({
      note: "Host file 'host/alpha.md' is not available for the '../shadcn' plugin. Valid host files: (none)." });
  });

  it('refuses an overlay file over the cap with its own wording, and lists (none) when there is no host folder', async () => {
    expect(await readHostPluginFile({ pluginId: 'bigfile', file: 'host/huge.md', overlaysDir })).toEqual({
      note: `Host file 'host/huge.md' is over ${MAX_HOST_PLUGIN_FILE_BYTES} bytes for the 'bigfile' plugin. Valid host files: host/huge.md.` });
    expect(await readHostPluginFile({ pluginId: 'exact', file: 'host/a.md', overlaysDir })).toEqual({
      note: "Host file 'host/a.md' is not available for the 'exact' plugin. Valid host files: (none)." });
  });
});

describe('removeChatRefusedToolPermissions', () => {
  const strip = (text: string) => removeChatRefusedToolPermissions({ text });

  it('removes a Bash item (bare or quoted) from a frontmatter allowed-tools list and keeps every other tool', () => {
    const text = ['---', 'name: shadcn', 'allowed-tools:', '  - Read', '  - Bash', '  - "Bash"', "  - 'Bash'", '  - BashOutput', '  - Write', '---', 'Body.'].join('\n');
    expect(strip(text)).toBe(['---', 'name: shadcn', 'allowed-tools:', '  - Read', '  - BashOutput', '  - Write', '---', 'Body.'].join('\n'));
  });

  it('leaves text byte-identical when there is nothing to remove', () => {
    const text = '# Title\n\n  - Bash\n\nplain body\n';
    expect(strip(text)).toBe(text);
  });

  it('keeps a Bash list item in the body, in code fences, and after a markdown rule that is not YAML', () => {
    const text = ['intro', '', '---', 'a rule, not a mapping', '---', '  - Bash', '', '```yaml', '---', 'allowed-tools:', '  - Bash', '---', '```', '~~~', '  - Bash', '~~~'].join('\n');
    expect(strip(text)).toBe(text);
  });

  it('only opens frontmatter at the top, after a blank line, or after an AGENT_PLUGIN section header', () => {
    const block = ['---', 'allowed-tools:', '  - Bash', '  - Read', '---'];
    const filtered = ['---', 'allowed-tools:', '  - Read', '---'];
    expect(strip(['prose line', ...block].join('\n'))).toBe(['prose line', ...block].join('\n'));
    expect(strip(['<<AGENT_PLUGIN shadcn>>', ...block].join('\n'))).toBe(['<<AGENT_PLUGIN shadcn>>', ...filtered].join('\n'));
    expect(strip(['prose line', '', ...block].join('\n'))).toBe(['prose line', '', ...filtered].join('\n'));
  });

  it('treats an unterminated block, or one whose body is not a YAML mapping, as body text', () => {
    const unterminated = ['---', 'allowed-tools:', '  - Bash'].join('\n');
    expect(strip(unterminated)).toBe(unterminated);
    const scalar = ['---', 'just a sentence', '  - Bash', '---'].join('\n');
    expect(strip(scalar)).toBe(scalar);
    const broken = ['---', 'allowed-tools: [unclosed', '  - Bash', '---'].join('\n');
    expect(strip(broken)).toBe(broken);
  });

  it('filters every frontmatter block in a text with several run sections', () => {
    const section = (name: string) => [`<<AGENT_PLUGIN ${name}>>`, '---', 'allowed-tools:', '  - Bash', '  - Read', '---'];
    const out = strip([...section('a'), ...section('b')].join('\n'));
    expect(out).not.toContain('Bash');
    expect(out.match(/- Read/g)).toHaveLength(2);
  });
});

describe('deliverHostPluginGuidance', () => {
  const base = { pluginId: 'shadcn', guidance: 'Plugin guidance.', files: ['skills/x.md'] };

  it('puts the host GUIDANCE.md before the plugin guidance and appends host file names after the plugin\'s own', async () => {
    expect(await deliverHostPluginGuidance({ result: base, overlaysDir })).toEqual({
      guidance: 'Host rule: use site_write.\n\nPlugin guidance.', files: ['skills/x.md', 'host/alpha.md', 'host/zeta.md'] });
  });

  it('keeps a leading notice first, ahead of the host guidance, without duplicating it', async () => {
    const result = await deliverHostPluginGuidance({ result: { ...base, guidance: 'NOTICE: beta\n\nPlugin guidance.' }, overlaysDir }, { notice: 'NOTICE: beta' });
    expect(result.guidance).toBe('NOTICE: beta\n\nHost rule: use site_write.\n\nPlugin guidance.');
  });

  it('delivers a requested host file instead of the skill guidance, still behind the notice', async () => {
    const result = await deliverHostPluginGuidance({ result: { ...base, guidance: 'NOTICE: beta\n\nPlugin guidance.' }, file: 'host/alpha.md', overlaysDir }, { notice: 'NOTICE: beta' });
    expect(result).toEqual({ guidance: 'NOTICE: beta\n\nalpha text', files: ['skills/x.md', 'host/alpha.md', 'host/zeta.md'] });
  });

  it('keeps the skill guidance (host rules first) and adds a note when the requested host file is refused, joined to the plugin\'s own note', async () => {
    const result = await deliverHostPluginGuidance({ result: { ...base, note: 'Plugin note.' }, file: 'host/missing.md', overlaysDir });
    expect(result.guidance).toBe('Host rule: use site_write.\n\nPlugin guidance.');
    expect(result.note).toBe("Plugin note. Host file 'host/missing.md' is not available for the 'shadcn' plugin. Valid host files: host/alpha.md, host/zeta.md.");
  });

  it('passes a plugin with no overlay through unchanged, with no note key', async () => {
    const result = await deliverHostPluginGuidance({ result: { pluginId: 'plain', guidance: 'Just this.' }, overlaysDir });
    expect(result).toEqual({ guidance: 'Just this.', files: [] });
    expect('note' in result).toBe(false);
  });

  it('applies the chat Bash filter to what it delivers', async () => {
    const guidance = ['---', 'allowed-tools:', '  - Bash', '  - Read', '---', 'Body.'].join('\n');
    const result = await deliverHostPluginGuidance({ result: { pluginId: 'plain', guidance }, overlaysDir });
    expect(result.guidance).toBe(['---', 'allowed-tools:', '  - Read', '---', 'Body.'].join('\n'));
  });
});

describe('splitHostPluginRefRequest', () => {
  // Any delivery mode other than "pointer" carries the guidance inline.
  const INLINE = 'inline' as unknown as AgentPluginDeliveryMode;
  const split = (options: Parameters<typeof splitHostPluginRefRequest>[0]['options'], defaultDeliveryMode: AgentPluginDeliveryMode = INLINE) =>
    splitHostPluginRefRequest({ options, defaultDeliveryMode });

  it('hands the owner everything except a host/ file, which becomes the overlay\'s', () => {
    expect(split({ skill: 's', file: 'host/alpha.md' })).toEqual({ ownerOptions: { skill: 's' }, overlay: { includeGuidance: true, file: 'host/alpha.md' } });
  });

  it('leaves a plugin\'s own file request untouched for the owner', () => {
    const options = { file: 'skills/x.md' };
    const result = split(options);
    expect(result.ownerOptions).toBe(options);
    expect(result.overlay).toEqual({ includeGuidance: true });
  });

  it('keeps pointer delivery with nothing selected as the owner\'s pointer: its tool call carries the overlay, so guidance is not added twice', () => {
    expect(split({}, 'pointer').overlay).toEqual({ includeGuidance: false });
    expect(split({ deliveryMode: 'pointer' }).overlay).toEqual({ includeGuidance: false });
    expect(split({ skill: 's' }, 'pointer').overlay).toEqual({ includeGuidance: true });
    expect(split({ file: 'skills/x.md' }, 'pointer').overlay).toEqual({ includeGuidance: true });
    expect(split({ deliveryMode: INLINE }, 'pointer').overlay, 'an explicit non-pointer mode wins over a pointer default').toEqual({ includeGuidance: true });
  });

  it('a host file counts as a selection: under pointer delivery it still reaches the overlay, together with the guidance', () => {
    expect(split({ file: 'host/alpha.md' }, 'pointer')).toEqual({ ownerOptions: {}, overlay: { includeGuidance: true, file: 'host/alpha.md' } });
  });
});

describe('readHostPluginRefOverlays', () => {
  it('collects each pinned plugin\'s guidance and skips plugins that have none', async () => {
    expect(await readHostPluginRefOverlays({ pluginRefIds: ['shadcn', 'nothing-here', 'exact'], includeGuidance: true, overlaysDir })).toMatchObject({ ok: true, fileSections: [] });
    const result = await readHostPluginRefOverlays({ pluginRefIds: ['nothing-here', 'shadcn'], includeGuidance: true, overlaysDir });
    expect(result).toEqual({ ok: true, guidance: ['Host rule: use site_write.'], fileSections: [] });
  });

  it('adds no guidance when the caller already carries it (pointer delivery)', async () => {
    expect(await readHostPluginRefOverlays({ pluginRefIds: ['shadcn'], includeGuidance: false, overlaysDir })).toEqual({ ok: true, guidance: [], fileSections: [] });
  });

  it('frames a requested host file with its plugin and name, once per pinned plugin that has it', async () => {
    expect(await readHostPluginRefOverlays({ pluginRefIds: ['shadcn'], includeGuidance: true, file: 'host/alpha.md', overlaysDir })).toEqual({
      ok: true, guidance: ['Host rule: use site_write.'], fileSections: ["Host file host/alpha.md for Agent Plugin 'shadcn':\nalpha text"] });
  });

  it('refuses the whole run, with the note, when any pinned plugin lacks the requested host file', async () => {
    expect(await readHostPluginRefOverlays({ pluginRefIds: ['shadcn', 'onlyfiles'], includeGuidance: false, file: 'host/alpha.md', overlaysDir })).toEqual({
      ok: false, reason: "Host file 'host/alpha.md' is not available for the 'onlyfiles' plugin. Valid host files: host/one.md." });
  });
});
