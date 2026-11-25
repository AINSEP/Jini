import type ts from "typescript";

export interface SealViolation {
  /** Repo-root-relative path (real-scan mode) or the caller-supplied display path (unit-test mode). */
  file: string;
  /** 1-based line number of the call expression's start. */
  line: number;
  /** The call expression's source text, whitespace-collapsed to one line for reporting. */
  text: string;
  reason: "missing-aad" | "aad-literally-undefined" | "unresolved-argument-shape";
}

/**
 * Core per-file scanner, unit-testable directly against synthetic source text (no filesystem, no
 * `ts.Program`). Finds every `<expr>.seal(...)` call and checks its argument shape.
 *
 * @complexity O(n) single AST walk, n = node count in the parsed file.
 */
export function findSealCallsInSource(
  { sourceText, displayPath, ast, isExempt }: { sourceText: string; displayPath: string; ast: typeof ts; isExempt: (required: { displayPath: string; text: string }, optional?: Record<string, never>) => boolean },
  _optional: Record<string, never> = {}
): SealViolation[] {
  const scriptKind = displayPath.endsWith(".tsx") ? ast.ScriptKind.TSX : ast.ScriptKind.TS;
  const source = ast.createSourceFile(displayPath, sourceText, ast.ScriptTarget.Latest, true, scriptKind);
  const violations: SealViolation[] = [];

  function lineOf({ pos }: { pos: number }, _optional: Record<string, never> = {}): number {
    return source.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function visit(node: ts.Node): void {
    if (ast.isCallExpression(node) && ast.isPropertyAccessExpression(node.expression) && node.expression.name.text === "seal") {
      const violation = checkSealCallArguments({ call: node, source, displayPath, lineOf, ast, isExempt });
      if (violation) violations.push(violation);
    }
    ast.forEachChild(node, visit);
  }
  visit(source);

  return violations;
}

function buildSealViolation(
  { reason, displayPath, line, text }: { reason: SealViolation["reason"]; displayPath: string; line: number; text: string },
  _optional: Record<string, never> = {}
): SealViolation {
  return { file: displayPath, line, text, reason };
}

/** Finds the `aad` property among a `.seal()` call's object-literal properties. Returns
 *  `"unresolved"` when a spread makes it impossible to statically know whether `aad` is
 *  included (fail-closed — see file header), or `null` when no `aad` property is present. */
function findAadProperty(
  { properties, ast }: { properties: ts.NodeArray<ts.ObjectLiteralElementLike>; ast: typeof ts },
): ts.ObjectLiteralElementLike | "unresolved" | null {
  for (const prop of properties) {
    if (ast.isSpreadAssignment(prop)) return "unresolved";
    if (prop.name && ast.isIdentifier(prop.name) && prop.name.text === "aad") return prop;
  }
  return null;
}

function isLiterallyUndefined({ prop, ast }: { prop: ts.ObjectLiteralElementLike; ast: typeof ts }): boolean {
  return (
    ast.isPropertyAssignment(prop) && ast.isIdentifier(prop.initializer) && prop.initializer.text === "undefined"
  );
}

function checkSealCallArguments(
  {
    call,
    source,
    displayPath,
    lineOf,
    ast,
    isExempt,
  }: {
    ast: typeof ts;
    isExempt: (required: { displayPath: string; text: string }, optional?: Record<string, never>) => boolean;
    call: ts.CallExpression;
    source: ts.SourceFile;
    displayPath: string;
    lineOf: ({ pos }: { pos: number }) => number;
  },
  _optional: Record<string, never> = {}
): SealViolation | null {
  const line = lineOf({ pos: call.getStart(source) });
  const text = call.getText(source).replace(/\s+/g, " ").trim();

  if (isExempt({ displayPath, text })) return null;

  const first = call.arguments[0];
  if (call.arguments.length !== 1 || first === undefined || !ast.isObjectLiteralExpression(first)) {
    return buildSealViolation({ reason: "unresolved-argument-shape", displayPath, line, text });
  }

  const aadProp = findAadProperty({ properties: first.properties, ast });
  if (aadProp === "unresolved") return buildSealViolation({ reason: "unresolved-argument-shape", displayPath, line, text });
  if (aadProp === null) return buildSealViolation({ reason: "missing-aad", displayPath, line, text });
  if (isLiterallyUndefined({ prop: aadProp, ast })) return buildSealViolation({ reason: "aad-literally-undefined", displayPath, line, text });

  return null; // `aad` present with a real value, or shorthand `{ aad }` — compliant.
}

