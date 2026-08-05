/**
 * R10 (REF-001 Step D, disabled/reporting-only — see guard.ts's wiring comment):
 * `ChatPane` — the one product-like composition this package's otherwise-neutral React barrel
 * still exports (see `packages/chat/src/react/index.ts`'s own module doc and
 * `ADS-memory/reports/refactor/2026-08-05-ref-001-steps-bcd-proposal.md` §1) — must not reach for
 * anything a consumer of the published `@jini-ai/chat/react` API could not also reach for. If
 * `ChatPane` can do something a consumer cannot do with the public API, that is a bug in the API,
 * not a privilege `ChatPane` is entitled to. This is the mechanical form of that invariant.
 *
 * **What this checks:** every relative import inside `features/chat-pane/**` whose resolved
 * target ESCAPES that directory (reaches a sibling module elsewhere under `src/react/**`, e.g.
 * `../../components/Composer.js`) is a `ChatPane`-internal composition reaching outside its own
 * subtree. Every name pulled from that import must appear in the public barrel's export list
 * (currently `packages/chat/src/react/index.ts`; update `barrelPath` here when Step C moves
 * `ChatPane` to its own subpath and the barrel becomes whichever file re-exports the public
 * surface at that point).
 *
 * **What this deliberately does NOT check (documented scope limit, matching this codebase's own
 * regex-MVP-not-full-AST convention — see `lib/walk-imports.ts`'s module doc):**
 * - Transitive reach. If `ChatPane` imports `MessageList` (public, fine) and `MessageList` itself
 *   privately imports something non-public, this check does not follow that second hop — it only
 *   checks files physically inside `features/chat-pane/**`. Closing that gap needs either a real
 *   module-graph walk or moving the whole reachable set under `chat-pane/**`, neither of which
 *   this pass attempts.
 * - Bare `@jini-ai/*` imports. Those are R1/R2's job (`check-engine-boundaries.ts`); this check is
 *   scoped to same-package sibling reach only.
 * - Type-only vs. value distinction. A type reached only for annotation purposes is still flagged
 *   if absent from the barrel, on the theory that a consumer implementing the same prop/callback
 *   shape needs to be able to name that type too.
 *
 * **Why shipped disabled:** `features/chat-pane/**` is mid-restructure by a concurrent agent as of
 * 2026-08-05 (see the same report's "Ordering" section) and Section 1 of that report — whether
 * `ChatPane` stays in the generic barrel at all — was still open when this was written. Running
 * this in reporting-only mode now proves the checker itself works without gating anyone's build on
 * an unsettled directory and an unconfirmed architecture call.
 */
import { dirname, join, relative, resolve } from 'node:path';
import type { Violation } from './check-engine-boundaries.js';
import { listSourceFiles, REPO_ROOT, stripComments } from './lib/walk-imports.js';
import { readFileSync } from 'node:fs';

/** `import`/`export { ... }` and `import/export type { ... }` named-clause blocks, multi-line. */
const NAMED_IMPORT_RE = /\bimport\s+(type\s+)?\{([^}]*)\}\s+from\s+['"](\.[^'"]+)['"]/g;
/** `export { ... }` / `export type { ... }` blocks in the public barrel (re-export target ignored — only the local/exported name matters for "is this name public"). */
const NAMED_EXPORT_RE = /\bexport\s+(type\s+)?\{([^}]*)\}(?:\s+from\s+['"][^'"]+['"])?/g;

/** Splits a `{ A, type B, C as D }` clause body into the names a consumer would import it as. */
function namesFromClause(body: string): string[] {
  return body
    .split(',')
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => raw.replace(/^type\s+/, ''))
    .map((raw) => {
      const asMatch = raw.match(/^\S+\s+as\s+(\S+)$/);
      return asMatch ? asMatch[1]! : raw;
    });
}

/** Parses every name the public barrel exports (value or type — this check does not distinguish). */
function parsePublicSurface(absBarrelPath: string): Set<string> {
  const content = stripComments(readFileSync(absBarrelPath, 'utf8'));
  const names = new Set<string>();
  for (const m of content.matchAll(NAMED_EXPORT_RE)) {
    for (const name of namesFromClause(m[2]!)) names.add(name);
  }
  return names;
}

export interface CheckChatPanePublicSurfaceOptions {
  /** Treat this directory as the repo root for path classification. */
  readonly repoRoot?: string;
  /** Treat this directory as the privileged composition's own subtree. Defaults to `<repoRoot>/packages/chat/src/react/features/chat-pane`. */
  readonly chatPaneDir?: string;
  /** Treat this file as the public barrel to check names against. Defaults to `<repoRoot>/packages/chat/src/react/index.ts`. */
  readonly barrelPath?: string;
}

/**
 * @param options Overrides so a self-test can run this against known-bad fixtures instead of the
 * real (as of 2026-08-05, concurrently-edited) `features/chat-pane/**` tree — see this file's own
 * module doc's "Why shipped disabled" note.
 */
export async function checkChatPanePublicSurface(
  options: CheckChatPanePublicSurfaceOptions = {},
): Promise<Violation[]> {
  const root = options.repoRoot ?? REPO_ROOT;
  const chatPaneDir = options.chatPaneDir ?? join(root, 'packages', 'chat', 'src', 'react', 'features', 'chat-pane');
  const barrelAbs = options.barrelPath ?? join(root, 'packages', 'chat', 'src', 'react', 'index.ts');
  const violations: Violation[] = [];

  const chatPaneDirRel = relative(root, chatPaneDir).split('\\').join('/');
  const publicSurface = parsePublicSurface(barrelAbs);

  for (const absFile of listSourceFiles(chatPaneDir)) {
    const file = relative(root, absFile).split('\\').join('/');
    const content = stripComments(readFileSync(absFile, 'utf8'));

    for (const m of content.matchAll(NAMED_IMPORT_RE)) {
      const clauseBody = m[2]!;
      const specifier = m[3]!;

      const resolvedAbs = resolve(dirname(absFile), specifier);
      const resolvedRel = relative(root, resolvedAbs).split('\\').join('/');
      // Only imports that ESCAPE chat-pane's own subtree are in scope — a relative import that
      // stays inside features/chat-pane/** is ChatPane composing its own internals, not reaching
      // for something a consumer couldn't also reach.
      if (resolvedRel === chatPaneDirRel || resolvedRel.startsWith(`${chatPaneDirRel}/`)) continue;

      for (const name of namesFromClause(clauseBody)) {
        if (!publicSurface.has(name)) {
          violations.push({
            rule: 'R10-chatpane-public-surface',
            file,
            reason: `imports "${name}" from "${specifier}" (resolves outside features/chat-pane/**), but "${name}" is not in the public barrel's export list (${relative(root, barrelAbs).split('\\').join('/')}) — a consumer of the published API could not reach this the same way ChatPane does`,
          });
        }
      }
    }
  }

  return violations;
}
