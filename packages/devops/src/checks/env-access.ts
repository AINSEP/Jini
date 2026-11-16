/** Environment-access rules of the hardwiring audit.
 *
 * Reading configuration from the ambient environment is the job of a process entry. Everything
 * else receives a value or an environment map from its host. These rules report the code that
 * reaches for the ambient object itself; the host classifies each file (it owns the list of
 * entries) and keeps existing occurrences in a debt file that may only shrink.
 *
 * They share the hardwiring inspector's parser, its definition of `process.env` and of module
 * scope, its violation shape and its debt ratchet (`diffHardwiringDebt`), so one waiver format
 * covers both audits. Name-based rules (which names exist, which may be read from an injected
 * map) need the host's schema and are added with it; nothing here keeps a list of names.
 */
import type ts from 'typescript';
import type { createHardwiringInspector, HardwiringViolation } from './hardwiring.js';

export const ENV_ACCESS_RULES = ['HW9-env-access', 'HW12-env-import-time'] as const;

export interface EnvAccessSource {
  file: string;
  source: string;
  /** A declared process entry (a `bin` target, a host entry): it may touch the ambient environment. */
  envRoot: boolean;
  /** The owning package runs in a browser, DOM or universal runtime. There a bundler replaces the
   * exact expression `process.env.NODE_ENV` with a constant, so it is a build define, not a read. */
  buildDefine: boolean;
}

type HardwiringInspector = ReturnType<typeof createHardwiringInspector>;
type AmbientEnv = 'process.env' | 'import.meta.env';

const ACCESS_REASON = 'Only a declared process entry may touch process.env or import.meta.env; take the value or an environment map from the host.';
const IMPORT_TIME_REASON = 'This environment read runs while the module is being imported, before a host can supply configuration; move it into the process entry.';

/** Bind the installed compiler and the hardwiring inspector whose helpers these rules reuse.
 * Inspection is one O(n) walk over the file's AST nodes; no I/O, no module state.
 * Only the env name (or the ambient object's own name) is hashed for debt identity.
 */
export function createEnvAccessInspector({ compiler: c, inspector }: { compiler: typeof ts; inspector: HardwiringInspector }, _options: Record<string, never> = {}) {
  function isImportMetaEnv({ node }: { node: ts.Node }): boolean {
    return c.isPropertyAccessExpression(node) && node.name.text === 'env' &&
      c.isMetaProperty(node.expression) && node.expression.keywordToken === c.SyntaxKind.ImportKeyword;
  }

  function ambientEnv({ node }: { node: ts.Node }): AmbientEnv | undefined {
    if (inspector.isProcessEnv({ node })) return 'process.env';
    return isImportMetaEnv({ node }) ? 'import.meta.env' : undefined;
  }

  /** The static name read directly off the ambient object (`process.env.X`, `import.meta.env['X']`). */
  function staticKey({ node }: { node: ts.Node }): string | undefined {
    const parent = node.parent;
    if (c.isPropertyAccessExpression(parent) && parent.expression === node) return parent.name.text;
    if (c.isElementAccessExpression(parent) && parent.expression === node && c.isStringLiteralLike(parent.argumentExpression)) return parent.argumentExpression.text;
    return undefined;
  }

  /** Only the exact expression is a define: `process.env`, `process.env[name]` and other keys stay reads. */
  function isBuildDefine({ input, owner, key }: { input: EnvAccessSource; owner: AmbientEnv; key: string | undefined }): boolean {
    return input.buildDefine && owner === 'process.env' && key === 'NODE_ENV';
  }

  /** Report every reference to the ambient environment outside a process entry.
   * A module-scope reference is reported under both rules: it is an access, and it runs at import.
   * Reads reached through a call made at module scope are invisible to a syntax rule; an
   * import-recording test in the host covers those.
   */
  function inspect(input: EnvAccessSource, _options: Record<string, never> = {}): HardwiringViolation[] {
    const tree = inspector.parse(input);
    if (input.envRoot) return [];
    const found: HardwiringViolation[] = [];
    function visit(node: ts.Node): void {
      const owner = ambientEnv({ node });
      const key = owner ? staticKey({ node }) : undefined;
      if (owner && !isBuildDefine({ input, owner, key })) {
        const identity = key ?? owner;
        found.push(inspector.violation({ tree, node, rule: 'HW9-env-access', reason: ACCESS_REASON, identity }));
        if (inspector.isModuleScope({ node })) found.push(inspector.violation({ tree, node, rule: 'HW12-env-import-time', reason: IMPORT_TIME_REASON, identity }));
      }
      c.forEachChild(node, visit);
    }
    visit(tree);
    return found;
  }

  return { inspect };
}
