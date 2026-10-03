/** One repository-wide source-neutrality guard.
 * Source paths and the consumer identity are forbidden even in rationale comments.
 * Runtime wording and specification IDs are inspected in literals, leaving rationale intact.
 * The allowlist starts empty. Each exception requires an exact file, rule and reason.
 *
 * Historical predecessor names can remain in provenance comments; a live consumer's
 * identity cannot. The original identity sweep found its leaks in documentation comments,
 * so stripping comments before that check would falsely report clean. Identity matching
 * is therefore a case-insensitive substring scan over raw text, independent of the runtime
 * literal rules. Source neutrality does not prove historical docs or generated output clean;
 * those require separate packaging and repository inventories.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { REPO_ROOT } from './walk-imports.js';
import { packageSourceFiles, parseSource, sourcePackages } from './package-sources.js';

export interface NeutralityViolation { rule: string; file: string; reason: string }
export interface NeutralityException { file: string; rule: string; reason: string }
const rawRules = [
  { rule: 'N1-consumer-identity', pattern: /tovu/i },
  { rule: 'N2-consumer-path', pattern: /apps\/(?:website|admin|desktop)|#src\// },
];
const literalRules = [
  { rule: 'N3-host-copy', pattern: /Settings →|this site|EXTERNAL_MCP|g3-approval/ },
  { rule: 'N4-runtime-spec-id', pattern: /U-0\d\d|REQ-|SEC-|INV-|SPEC-/ },
];

export function checkSourceNeutrality(
  required: { repoRoot: string } = { repoRoot: REPO_ROOT },
  optional: { allowlistPath?: string } = {},
): NeutralityViolation[] {
  const violations: NeutralityViolation[] = [];
  const root = required.repoRoot;
  const allowlistPath = optional.allowlistPath ?? join(root, 'scripts/source-neutrality-allowlist.json');
  // Missing/invalid policy fails closed rather than silently ignoring configuration drift.
  if (!existsSync(allowlistPath)) return [{ rule: 'N0-allowlist', file: relative(root, allowlistPath), reason: 'missing neutrality allowlist' }];
  const value: unknown = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  if (!Array.isArray(value)) return [{ rule: 'N0-allowlist', file: relative(root, allowlistPath), reason: 'allowlist must be an array' }];
  const entries: NeutralityException[] = [];
  for (const entry of value) {
    if (typeof entry?.file !== 'string' || typeof entry?.rule !== 'string' || typeof entry?.reason !== 'string' || !entry.reason.trim()
      || ![...rawRules, ...literalRules].some(rule => rule.rule === entry.rule)) {
      violations.push({ rule: 'N0-allowlist', file: relative(root, allowlistPath), reason: 'every exception needs a file, known rule and nonempty reason' });
    } else entries.push(entry);
  }
  const used = new Set<NeutralityException>();
  function add(file: string, rule: string, reason: string): void {
    const exemption = entries.find(entry => entry.file === file && entry.rule === rule);
    if (exemption) { used.add(exemption); return; }
    violations.push({ rule, file, reason });
  }
  for (const pkg of sourcePackages({ packagesDir: join(root, 'packages') })) {
    for (const filename of packageSourceFiles({ directory: pkg.directory })) {
      const file = relative(root, filename).split('\\').join('/');
      const source = readFileSync(filename, 'utf8');
      for (const rule of rawRules) {
        const match = rule.pattern.exec(source);
        if (match) add(file, rule.rule, `forbidden source reference ${JSON.stringify(match[0])} (comments included)`);
      }
      function inspect(text: string, offset: number): void {
        const productMatch = rawRules[0]!.pattern.exec(text);
        if (productMatch && !rawRules[0]!.pattern.test(source)) add(file, rawRules[0]!.rule,
          `line ${source.slice(0, offset).split('\n').length}: forbidden decoded consumer identity`);
        for (const rule of literalRules) {
          const match = rule.pattern.exec(text);
          if (match) add(file, rule.rule, `line ${source.slice(0, offset).split('\n').length}: forbidden runtime literal ${JSON.stringify(match[0])}`);
        }
      }
      if (filename.endsWith('.css')) {
        // CSS has only block comments; mask them without changing offsets or string contents.
        const tokens = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
        for (const match of source.matchAll(tokens)) if (!match[0].startsWith('/*')) inspect(match[0], match.index);
      } else {
        const ast = parseSource({ file: filename, source });
        function visit(node: ts.Node): void {
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
            || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
            || ts.isJsxText(node)) inspect(node.text, node.getStart(ast));
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
    }
  }
  for (const entry of entries) if (!used.has(entry)) violations.push({ rule: 'N0-allowlist', file: entry.file, reason: `unused exception for ${entry.rule}; remove stale policy` });
  return violations;
}
