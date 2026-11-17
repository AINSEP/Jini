/**
 * Ratchet for the why-comment rule: refactors MOVE "why" comments with the code, never delete them.
 * Lists comment blocks deleted between --base and --head whose text survives nowhere (see
 * check-why-comments-lib.mjs) and exits 1 unless each is allow-listed with a reason in the debt file.
 *
 * Flags: --base <ref> (env WHY_COMMENTS_BASE_REF, default origin/refactor/terra), --head <ref> (HEAD),
 *   --merge-base (diff from merge-base(base, head); use in CI), --root <dir> (this repo),
 *   --other-root <dir> (repeatable; env WHY_COMMENTS_OTHER_ROOT, path-delimited; sibling repos whose
 *   current text also counts as "the comment still exists"), --debt <file> (allow-list).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLostBlocks, parseDebt, parseDiff } from './check-why-comments-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILE = {
  debt: 'scripts/why-comments-debt.json',
  siblings: ['../Tovu'],
  command: 'pnpm check:why-comments',
};
const DEFAULT_BASE = 'origin/refactor/terra';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const SKIP_FILE = /(\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp[34]|wasm|node|db|sqlite|lock)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml)$)/i;

function defaultGit(args, { cwd }) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
}

/** Current text of every tracked text file in a repo; large, binary and lock files cannot hold a moved comment. */
function defaultReadTexts(root, git) {
  const names = git(['ls-files', '-z'], { cwd: root }).split('\0').filter(Boolean);
  const texts = [];
  for (const name of names) {
    const file = path.join(root, name);
    if (SKIP_FILE.test(name) || !existsSync(file) || statSync(file).size > MAX_TEXT_BYTES) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.slice(0, 8000).includes('\0')) texts.push({ path: name, text });
  }
  return texts;
}

function takeValue(argv, i) {
  if (!argv[i + 1]) throw new Error(`${argv[i]} needs a value`);
  return argv[i + 1];
}

export function parseArgs(argv, env = {}) {
  const opts = { base: env.WHY_COMMENTS_BASE_REF || DEFAULT_BASE, head: 'HEAD', mergeBase: false, root: undefined, debt: undefined, others: [] };
  const fromEnv = (env.WHY_COMMENTS_OTHER_ROOT ?? '').split(path.delimiter).filter(Boolean).map(p => path.resolve(p));
  opts.others.push(...fromEnv);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--') continue;
    else if (flag === '--merge-base') opts.mergeBase = true;
    else if (flag === '--base' || flag === '--head') opts[flag.slice(2)] = takeValue(argv, i++);
    else if (flag === '--root' || flag === '--debt') opts[flag.slice(2)] = path.resolve(takeValue(argv, i++));
    else if (flag === '--other-root') opts.others.push(path.resolve(takeValue(argv, i++)));
    else throw new Error(`unknown argument ${flag}; use --base, --head, --merge-base, --root, --other-root, --debt`);
  }
  return opts;
}

function siblingRoots(root, profile) {
  return profile.siblings.map(rel => path.resolve(root, rel)).filter(dir => existsSync(dir));
}

function collectRange({ opts, root, git }) {
  const base = opts.mergeBase ? git(['merge-base', opts.base, opts.head], { cwd: root }).trim() : opts.base;
  const diff = git(['-c', 'core.quotepath=false', 'diff', '-U0', '--no-renames', '--no-color', base, opts.head, '--', '*.ts', '*.tsx', '*.mjs', '*.js'], { cwd: root });
  const parsed = parseDiff(diff);
  const files = parsed.files.map(f => ({ ...f, oldSource: git(['show', `${base}:${f.oldPath}`], { cwd: root }) }));
  return { base, head: opts.head, files, addedTexts: parsed.addedTexts };
}

function excerpt(text) {
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function sortByLocation(blocks) {
  return [...blocks].sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);
}

function report({ lost, allow, command, io, range }) {
  const open = sortByLocation(lost.filter(b => !allow.has(b.id)));
  const allowed = lost.length - open.length;
  io.out(`why-comments: ${range.files.length} files with removed lines checked against ${range.base}..${range.head}, ${lost.length} comment blocks lost (${allowed} allow-listed)`);
  for (const b of open) io.err(`${b.file}:${b.startLine}-${b.endLine}  [${b.id}]  ${excerpt(b.normalized)}`);
  if (open.length === 0) { io.out('why-comments: ok'); return 0; }
  io.err(`why-comments: ${open.length} deleted comment blocks appear nowhere else (owner rule: refactors move "why" comments with the code, never delete them)`);
  io.err('  fix: put the comment back next to the code it explains, or move it with that code.');
  io.err(`  last resort: add { "id": "<id above>", "reason": "<why this comment is truly obsolete>" } to the debt file (\`${command}\`).`);
  return 1;
}

/**
 * @param {string[]} argv
 * @param {{out?: Function, err?: Function, env?: object, profile?: object, git?: Function, readTexts?: Function}} options
 */
export function runCli(argv, options = {}) {
  const io = { out: options.out ?? console.log, err: options.err ?? console.error };
  const profile = options.profile ?? PROFILE;
  const git = options.git ?? defaultGit;
  const readTexts = options.readTexts ?? (root => defaultReadTexts(root, git));
  try {
    const opts = parseArgs(argv, options.env ?? process.env);
    const root = opts.root ?? REPO_ROOT;
    const debtFile = opts.debt ?? path.join(root, profile.debt);
    const allow = existsSync(debtFile) ? parseDebt(readFileSync(debtFile, 'utf8')) : new Map();
    const range = collectRange({ opts, root, git });
    const roots = [...new Set([root, ...opts.others, ...siblingRoots(root, profile)])];
    const currentTexts = roots.flatMap(r => readTexts(r).map(entry => (r === root ? { ...entry, own: true } : entry)));
    const lost = findLostBlocks({ files: range.files, addedTexts: range.addedTexts, currentTexts });
    return report({ lost, allow, command: profile.command, io, range });
  } catch (error) {
    io.err(`why-comments: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
