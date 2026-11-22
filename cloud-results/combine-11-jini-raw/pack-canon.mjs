// canon.mjs <tgzA> <tgzB> : compare extracted tarball contents; package.json compared key-sorted
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
function files(tgz) {
  const d = mkdtempSync('/tmp/claude-0/c11/x-'); execFileSync('tar', ['-xzf', tgz, '-C', d]);
  const out = new Map(); const walk = p => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) walk(f); else {
    const rel = f.slice(d.length + 1); let buf = readFileSync(f);
    if (rel === 'package/package.json') buf = Buffer.from(JSON.stringify(sort(JSON.parse(buf))));
    out.set(rel, createHash('sha256').update(buf).digest('hex')); } } }; walk(d); return out; }
const [a, b] = [files(process.argv[2]), files(process.argv[3])];
const diff = [];
for (const [k, v] of a) if (!b.has(k)) diff.push('only-current ' + k); else if (b.get(k) !== v) diff.push('changed ' + k);
for (const k of b.keys()) if (!a.has(k)) diff.push('only-npm ' + k);
console.log(JSON.stringify({ filesCurrent: a.size, filesNpm: b.size, diff }));
