/**
 * R3: packages/protocol/** must not import any OD DTO / prompts / analytics / design-systems /
 * anything under foundry/**, examples/**, or AI-Dev-Shop/**.
 * Enforces the downward-only edge @od/* -> @jini-ai/protocol. Additionally: `@jini-ai/protocol` is
 * extraction-plan.md §3's foundational leaf ("pure wire types") — it must not import ANY other
 * `@jini-ai/*` package either, or it stops being a dependency-free base for the rest of the graph.
 * Kept separate from the engine-boundary check (as OD splits its guards) even though it shares
 * the same forbidden-directory list as `check-engine-boundaries.ts`'s R1, because protocol's
 * zero-`@jini-ai/*`-imports rule is stricter than and distinct from R1/R2.
 */
import { dirname, join, relative, resolve } from 'node:path';
import type { Violation } from './check-engine-boundaries.js';
import { extractImports, listSourceFiles, REPO_ROOT } from './lib/walk-imports.js';

const FORBIDDEN_TOP_LEVEL_DIRS = ['foundry', 'examples', 'AI-Dev-Shop'];

export interface CheckProtocolPurityOptions {
  /** Treat this directory as the repo root for both scanning and path classification. */
  readonly repoRoot?: string;
  /** Treat this directory as protocol's src root. Defaults to `<repoRoot>/packages/protocol/src`. */
  readonly protocolSrc?: string;
}

/** @param options Overrides for self-testing against fixtures — see `checkEngineBoundaries`'s doc. */
export async function checkProtocolPurity(
  options: CheckProtocolPurityOptions = {},
): Promise<Violation[]> {
  const root = options.repoRoot ?? REPO_ROOT;
  const violations: Violation[] = [];
  const protocolSrc = options.protocolSrc ?? join(root, 'packages', 'protocol', 'src');
  const files = listSourceFiles(protocolSrc);

  for (const absFile of files) {
    const file = relative(root, absFile).split('\\').join('/');

    for (const ref of extractImports(absFile)) {
      const spec = ref.specifier;

      if (spec.startsWith('@jini-ai/')) {
        violations.push({
          rule: 'R3-protocol-purity',
          file,
          reason: `imports "${spec}" — @jini-ai/protocol must have zero @jini-ai/* dependencies (it is the foundational leaf)`,
        });
        continue;
      }

      if (spec.startsWith('.')) {
        const resolvedAbs = resolve(dirname(absFile), spec);
        const resolvedRel = relative(root, resolvedAbs).split('\\').join('/');
        const topSegment = resolvedRel.split('/')[0] ?? '';
        if (FORBIDDEN_TOP_LEVEL_DIRS.includes(topSegment)) {
          violations.push({
            rule: 'R3-protocol-purity',
            file,
            reason: `relative import "${spec}" resolves into ${topSegment}/ — protocol must not depend on OD/product code`,
          });
        }
      }
    }
  }

  return violations;
}
