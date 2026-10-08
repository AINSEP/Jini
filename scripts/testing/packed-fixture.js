/** Offline packed imports use plain Node in a disposable directory, never workspace symlinks. */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
export const packages = fileURLToPath(new URL('../../packages/', import.meta.url));
export function fixture(prefix) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    return dir;
}
export function pack(dir, name) {
    const source = join(packages, name), dest = join(dir, 'node_modules', '@jini-ai', name);
    mkdirSync(dest, { recursive: true });
    const result = JSON.parse(execFileSync('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', join(dir, 'npm-cache'), '--pack-destination', dir], { cwd: source, encoding: 'utf8' }));
    execFileSync('tar', ['-xzf', join(dir, result[0].filename), '-C', dest, '--strip-components', '1']);
}
export function copyPackage(dir, name, source) {
    const dest = join(dir, 'node_modules', name), root = realpathSync(source);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(root, dest, { recursive: true, filter: path => !relative(root, path).split(sep).includes('node_modules') });
}
export function copyRuntimeTree(dir, name, source, seen = new Set()) {
    if (seen.has(name))
        return;
    seen.add(name);
    copyPackage(dir, name, source);
    const root = realpathSync(source), manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), req = createRequire(join(root, 'package.json'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        if (dependency.startsWith('@jini-ai/')) {
            copyRuntimeTree(dir, dependency, join(packages, dependency.slice('@jini-ai/'.length)), seen);
            continue;
        }
        const candidate = (req.resolve.paths(dependency) ?? []).map(path => join(path, dependency)).find(path => existsSync(join(path, 'package.json')));
        let parent = candidate ? realpathSync(candidate) : dirname(realpathSync(req.resolve(dependency)));
        while (!existsSync(join(parent, 'package.json')) || JSON.parse(readFileSync(join(parent, 'package.json'), 'utf8')).name !== dependency) {
            const next = dirname(parent);
            if (next === parent)
                throw new Error(`Cannot locate ${dependency}`);
            parent = next;
        }
        copyRuntimeTree(dir, dependency, parent, seen);
    }
}
export function run(dir, source) { return spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: dir, encoding: 'utf8' }); }
//# sourceMappingURL=packed-fixture.js.map