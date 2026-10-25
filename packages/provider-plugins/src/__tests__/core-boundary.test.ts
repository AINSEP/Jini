/**
 * Obs #3 / Langfuse #10 boundary: vendor SDKs live only in this distribution's plugin sources.
 * Scans every other workspace package's source imports and manifest dependency fields. What this does
 * NOT catch: a vendor reached through an unlisted transitive dependency, or a computed import
 * specifier (`import(name)`); the packed-install test covers what the plugins themselves bundle.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const packagesRoot = fileURLToPath(new URL('../../..', import.meta.url));
const VENDOR = /^(?:@opentelemetry\/|@sentry\/|posthog-(?:node|js)$|langfuse(?:$|-)|stripe$)/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(full));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

it('no core package imports or declares a vendor SDK', async () => {
  const offenders: string[] = [];
  const packages = (await readdir(packagesRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name !== 'provider-plugins');
  expect(packages.length).toBeGreaterThan(20);
  for (const { name } of packages) {
    const root = path.join(packagesRoot, name);
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8').catch(() => '{}')) as Record<string, Record<string, string> | undefined>;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dependency of Object.keys(manifest[field] ?? {})) if (VENDOR.test(dependency)) offenders.push(`${name}/package.json ${field}: ${dependency}`);
    }
    const src = path.join(root, 'src');
    for (const file of await sourceFiles(src).catch(() => [])) {
      for (const match of (await readFile(file, 'utf8')).matchAll(SPECIFIER)) if (VENDOR.test(match[1]!)) offenders.push(`${path.relative(packagesRoot, file)}: ${match[1]}`);
    }
  }
  expect(offenders).toEqual([]);
});

it.each(['@opentelemetry/api', '@sentry/node', 'posthog-node', 'posthog-js', 'langfuse', 'stripe'])('the scan recognizes %s', (specifier) => {
  expect(VENDOR.test(specifier)).toBe(true);
});

it.each(['@jini-ai/diagnostics', 'stripe-like', 'posthog', 'node:fs'])('the scan ignores %s', (specifier) => {
  expect(VENDOR.test(specifier)).toBe(false);
});
