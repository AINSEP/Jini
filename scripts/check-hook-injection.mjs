/**
 * Ratchet for the hook-injection rule. Baseline: scripts/hook-injection-debt.json, keyed by
 * "ComponentName::hookName" so a moved or split file is not new debt. `--update` rewrites it.
 * Flags: --root <dir> scan another checkout; --baseline <file> compare against another baseline.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRoot } from './check-hook-injection-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILE = {
  scope: { areas: ['packages', 'examples'], include: /^(packages|examples)\/[^/]+\/src\// },
  baseline: 'scripts/hook-injection-debt.json',
  areaDepth: 2,
  command: 'pnpm check:hooks',
};

function parseArgs(argv) {
  const opts = { update: false, root: undefined, baseline: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--update') opts.update = true;
    else if (argv[i] === '--root' || argv[i] === '--baseline') {
      if (!argv[i + 1]) throw new Error(`${argv[i]} needs a value`);
      opts[argv[i].slice(2)] = path.resolve(argv[++i]);
    } else throw new Error(`unknown argument ${argv[i]}; use --update, --root <dir>, --baseline <file>`);
  }
  return opts;
}

export function buildEntries(findings) {
  const entries = {};
  for (const f of findings) {
    const entry = (entries[`${f.component}::${f.hook}`] ??= { count: 0, files: [] });
    entry.count += 1;
    if (!entry.files.includes(f.file)) entry.files.push(f.file);
  }
  return Object.fromEntries(Object.keys(entries).sort().map(key => [key, { count: entries[key].count, files: entries[key].files.sort() }]));
}

export function compareEntries(baseline, current) {
  const violations = [];
  const shrunk = [];
  for (const [key, entry] of Object.entries(current)) {
    const before = baseline[key]?.count ?? 0;
    if (entry.count > before) violations.push({ key, before, now: entry.count });
  }
  for (const [key, entry] of Object.entries(baseline)) if ((current[key]?.count ?? 0) < entry.count) shrunk.push(key);
  return { violations, shrunk };
}

function topCounts(pairs, limit) {
  const totals = new Map();
  for (const [name, n] of pairs) totals.set(name, (totals.get(name) ?? 0) + n);
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

export function summarize(findings, depth) {
  const components = new Set(findings.map(f => `${f.file}::${f.component}`)).size;
  const hooks = topCounts(findings.map(f => [f.hook, 1]), 8);
  const areas = topCounts(findings.map(f => [f.file.split('/').slice(0, depth).join('/'), 1]), 12);
  const fmt = rows => rows.map(([name, n]) => `${name} ${n}`).join(', ');
  return [`hook-injection: ${components} components, ${findings.length} direct custom-hook calls`, `top hooks: ${fmt(hooks)}`, `top folders: ${fmt(areas)}`];
}

function fixPattern({ key }) {
  const [component, hook] = key.split('::');
  return `  fix: function ${component}({ ${hook}Hook = ${hook} }) { const value = ${hook}Hook(); ... }`;
}

function describe(violation, findings) {
  const [component, hook] = violation.key.split('::');
  const where = findings.filter(f => f.component === component && f.hook === hook).map(f => `${f.file}:${f.line}`).join(', ');
  const delta = violation.before === 0 ? 'new' : `${violation.before} -> ${violation.now}`;
  return [`${where}  ${component} calls ${hook} directly (${delta}) [${violation.key}]`, fixPattern(violation)];
}

function readBaseline(file) {
  if (!existsSync(file)) throw new Error(`hook-injection baseline missing: ${file} (create it with --update)`);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed.entries !== 'object') throw new Error(`hook-injection baseline malformed: ${file} has no "entries" object`);
  return parsed.entries;
}

function check({ file, findings, current, profile, io }) {
  const { violations, shrunk } = compareEntries(readBaseline(file), current);
  summarize(findings, profile.areaDepth).forEach(line => io.out(line));
  if (violations.length) {
    io.err(`hook-injection: ${violations.length} new or increased entries (owner rule: hooks are injected as props defaulted to the real hook)`);
    violations.forEach(v => describe(v, findings).forEach(line => io.err(line)));
    return 1;
  }
  if (shrunk.length) io.out(`hook-injection: debt shrank for ${shrunk.length} entries; run \`${profile.command} -- --update\` to lock the lower baseline in`);
  io.out('hook-injection: ok');
  return 0;
}

export function runCli(argv, options = {}) {
  const io = { out: options.out ?? console.log, err: options.err ?? console.error };
  const profile = options.profile ?? PROFILE;
  try {
    const opts = parseArgs(argv);
    const findings = scanRoot(opts.root ?? REPO_ROOT, profile.scope);
    const current = buildEntries(findings);
    const file = opts.baseline ?? path.join(REPO_ROOT, profile.baseline);
    if (!opts.update) return check({ file, findings, current, profile, io });
    writeFileSync(file, `${JSON.stringify({ version: 1, entries: current }, null, 2)}\n`);
    summarize(findings, profile.areaDepth).forEach(line => io.out(line));
    io.out(`hook-injection: baseline written to ${file}`);
    return 0;
  } catch (error) {
    io.err(`hook-injection: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
