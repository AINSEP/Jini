import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'jini-ui-kit-headless-'));
try {
  const target = join(fixtureRoot, 'node_modules/@jini-ai/ui-kit');
  mkdirSync(target, { recursive: true });
  cpSync(join(packageRoot, 'dist'), join(target, 'dist'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  writeFileSync(join(target, 'package.json'), JSON.stringify(manifest));
  // A physical copy makes dependency resolution honest: a symlink could reach workspace React.
  writeFileSync(join(fixtureRoot, 'smoke.mjs'), `
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    const require = createRequire(import.meta.url);
    assert.throws(() => require.resolve('react'), {code:'MODULE_NOT_FOUND'});
    assert.throws(() => require.resolve('react-dom'), {code:'MODULE_NOT_FOUND'});
    assert.throws(() => require.resolve('vue'), {code:'MODULE_NOT_FOUND'});
    const kit = await import('@jini-ai/ui-kit');
    assert.equal(kit.KIT_CONTRACT.version, '1.0.0');
    assert.equal(kit.implementedComponents.length, 16);
    assert.equal(kit.planConfirm({open:true,title:'Delete?',confirmLabel:'Delete',tone:'danger'}).initialFocus, 'cancel');
    console.log('headless root smoke passed: no React, react-dom or Vue installed');
  `);
  process.stdout.write(execFileSync(process.execPath, [join(fixtureRoot, 'smoke.mjs')], { cwd: fixtureRoot, encoding: 'utf8' }));
} finally { rmSync(fixtureRoot, { recursive: true, force: true }); }
