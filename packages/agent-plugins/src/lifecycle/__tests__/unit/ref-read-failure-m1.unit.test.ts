import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createResolveAgentPluginRefsModule } from '../../resolve-agent-plugin-refs.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

it('refuses guidance if notes become unreadable after the installed skill has been read', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'plugin-ref-m1-')));
  const packageRoot = path.join(root, 'writer', 'package', 'sha256', 'a'.repeat(64));
  const notes = path.join(root, 'writer', 'memory', 'notes');
  try {
    await fs.mkdir(path.join(packageRoot, 'skills', 'writer'), { recursive: true });
    await fs.mkdir(notes, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'writer' }));
    await fs.writeFile(path.join(packageRoot, 'skills', 'writer', 'SKILL.md'), '# Writer\nPrivate guidance');
    let failedReads = 0;
    const readdir = (async (...args: Parameters<typeof fs.readdir>) => {
      if (String(args[0]) === notes) { failedReads++; throw Object.assign(new Error('notes at /private/host are unreadable'), { code: 'EACCES' }); }
      return fs.readdir(...args);
    }) as typeof fs.readdir;
    const api = createResolveAgentPluginRefsModule({ ...ports, filesystem: { ...ports.filesystem, readdir } });
    expect(await api.resolveAgentPluginRefs(['writer'], { root, packages: path.join(root, 'packages') }, 'inject')).toEqual({
      ok: false, reason: "Agent Plugin 'writer' has no readable 'skills/writer/SKILL.md' in its installed package: skill text is missing, refused, or unreadable",
    });
    expect(failedReads).toBe(1);
  } finally { await forceRemove(root); }
});
