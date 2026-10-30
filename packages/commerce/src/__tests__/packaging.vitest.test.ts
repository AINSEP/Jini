import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('ships the Open SaaS MIT attribution in the commerce npm file list', async () => {
  const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
  const cache = await mkdtemp(path.join(tmpdir(), 'commerce-pack-'));
  try {
    const packed = await promisify(execFile)('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '--cache', cache], { cwd: packageRoot, timeout: 30_000 });
    const [entry] = JSON.parse(packed.stdout) as Array<{ files: Array<{ path: string }> }>;
    expect(entry!.files.map(file => file.path)).toContain('NOTICE');
    const notice = await readFile(path.join(packageRoot, 'NOTICE'), 'utf8');
    expect(notice).toContain('Open SaaS');
    expect(notice).toContain('c2c6285bdb14b040584505372ad9bb062a0bca11');
    expect(notice).toContain('Copyright (c) 2023 wasp-lang');
    expect(notice).toContain('Permission is hereby granted, free of charge');
    expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  } finally { await rm(cache, { recursive: true, force: true }); }
}, 35_000);
