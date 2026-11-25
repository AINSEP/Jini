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

export const ENV_ACCESS_RULES = ['HW9-env-access', 'HW12-env-import-time', 'HW13-env-undeclared-entry'] as const;

export interface EnvAccessSource {
  file: string;
  source: string;
  /** A declared process entry (a `bin` target, a host entry): it may touch the ambient environment. */
  envRoot: boolean;
  /** The owning package runs in a browser, DOM or universal runtime. There a bundler replaces the
   * exact expression `process.env.NODE_ENV` with a constant, so it is a build define, not a read. */
  buildDefine: boolean;
  /** The names the host declares for this process entry. Absent means the entry has no declared
   * names. Only an entry consults it: a declared name never legalizes an ambient read in a library. */
  declaredEnvNames?: ReadonlySet<string>;
}

/** An injected environment map, such as the one a process entry hands to its helpers. */
export type DeclaredEnvMap = Readonly<Record<string, string | undefined>>;

type HardwiringInspector = ReturnType<typeof createHardwiringInspector>;
type AmbientEnv = 'process.env' | 'import.meta.env';

const ACCESS_REASON = 'Only a declared process entry may touch process.env or import.meta.env; take the value or an environment map from the host.';
const IMPORT_TIME_REASON = 'This environment read runs while the module is being imported, before a host can supply configuration; move it into the process entry.';
const UNDECLARED_REASON = 'This process entry reads an environment name that is not declared for it; declare the name for this entry or take the value from the host.';
const DYNAMIC_REASON = 'This process entry reads the environment with a computed key or an unbounded rest; read declared names, and use readDeclaredEnvKey for a computed key.';
/** Debt identity of a computed key or rest read: the runtime key is never known, nor reported. */
const DYNAMIC_IDENTITY = 'dynamic-key';
const UNDECLARED_KEY_MESSAGE = 'The requested environment name is not declared for this process entry.';

/** One key an entry takes from the ambient object; `key` is undefined when it is computed or a rest. */
interface EntryRead { node: ts.Node; key: string | undefined }

/** The checked accessor for a computed key: the entry's declared set decides before the map is indexed.
 * Fails with a fixed message that never names the requested key or any value.
 */
export function readDeclaredEnvKey(
  { env, declaredNames, key }: { env: DeclaredEnvMap; declaredNames: ReadonlySet<string>; key: string },
  _optional: Record<string, never> = {},
): string | undefined {
  if (!declaredNames.has(key)) throw new Error(UNDECLARED_KEY_MESSAGE);
  // A declared name missing from the map must not fall through to an inherited property.
  return Object.hasOwn(env, key) ? env[key] : undefined;
}

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

  /** A literal property name (`A`, `'A'`, `['A']`); a computed expression has no static key. */
  function propertyNameKey({ name }: { name: ts.PropertyName }): string | undefined {
    if (c.isIdentifier(name) || c.isStringLiteralLike(name) || c.isNumericLiteral(name)) return name.text;
    if (c.isComputedPropertyName(name) && c.isStringLiteralLike(name.expression)) return name.expression.text;
    return undefined;
  }

  /** `process.env.A`, `process.env['A']`, or a computed `process.env[name]`; undefined when the object is not indexed. */
  function memberReads({ node }: { node: ts.Node }): EntryRead[] | undefined {
    const parent = node.parent;
    if (c.isPropertyAccessExpression(parent) && parent.expression === node) return [{ node: parent, key: parent.name.text }];
    if (c.isElementAccessExpression(parent) && parent.expression === node) return [{ node: parent, key: staticKey({ node }) }];
    return undefined;
  }

  /** The source key of `A` or `A: local`; a nested pattern always carries its source key as `propertyName`. */
  function bindingElementKey({ element }: { element: ts.BindingElement }): string | undefined {
    if (element.propertyName) return propertyNameKey({ name: element.propertyName });
    return c.isIdentifier(element.name) ? element.name.text : undefined;
  }

  /** `const { A, B: b, ...rest } = process.env`, also as a parameter or binding default: one read per source key. */
  function bindingReads({ node }: { node: ts.Node }): EntryRead[] {
    const parent = node.parent;
    const bound = c.isVariableDeclaration(parent) || c.isParameter(parent) || c.isBindingElement(parent);
    if (!bound || parent.initializer !== node || !c.isObjectBindingPattern(parent.name)) return [];
    return parent.name.elements.map(element => ({ node: element,
      key: element.dotDotDotToken ? undefined : bindingElementKey({ element }) }));
  }

  /** `({ A, B: b, ...rest } = process.env)`: the assignment form of destructuring. */
  function assignmentReads({ node }: { node: ts.Node }): EntryRead[] {
    const parent = node.parent;
    if (!c.isBinaryExpression(parent) || parent.right !== node || parent.operatorToken.kind !== c.SyntaxKind.EqualsToken) return [];
    if (!c.isObjectLiteralExpression(parent.left)) return [];
    return parent.left.properties.map(property => ({ node: property,
      key: c.isSpreadAssignment(property) || !property.name ? undefined : propertyNameKey({ name: property.name }) }));
  }

  /** Forwarding the whole map (`{ env: process.env }`, `{ ...process.env }`) reads no key here; the
   * names its helpers read are inventoried in the entry's declaration instead. */
  function entryReads({ node }: { node: ts.Node }): EntryRead[] {
    return memberReads({ node }) ?? [...bindingReads({ node }), ...assignmentReads({ node })];
  }

  /** HW13: every key a process entry takes from the ambient object must be declared for that entry. */
  function entryViolations({ tree, input }: { tree: ts.SourceFile; input: EnvAccessSource }): HardwiringViolation[] {
    const declared = input.declaredEnvNames ?? new Set<string>();
    const found: HardwiringViolation[] = [];
    function visit(node: ts.Node): void {
      const owner = ambientEnv({ node });
      if (owner) for (const { node: at, key } of entryReads({ node })) {
        if (key !== undefined && (declared.has(key) || isBuildDefine({ input, owner, key }))) continue;
        found.push(inspector.violation({ tree, node: at, rule: 'HW13-env-undeclared-entry',
          reason: key === undefined ? DYNAMIC_REASON : UNDECLARED_REASON, identity: key ?? DYNAMIC_IDENTITY }));
      }
      c.forEachChild(node, visit);
    }
    visit(tree);
    return found;
  }

  /** Report every reference to the ambient environment outside a process entry.
   * A module-scope reference is reported under both rules: it is an access, and it runs at import.
   * Reads reached through a call made at module scope are invisible to a syntax rule; an
   * import-recording test in the host covers those.
   */
  function inspect(input: EnvAccessSource, _options: Record<string, never> = {}): HardwiringViolation[] {
    const tree = inspector.parse(input);
    // Handing a map into an entry does not grant its readers access to every ambient name.
    if (input.envRoot) return entryViolations({ tree, input });
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
