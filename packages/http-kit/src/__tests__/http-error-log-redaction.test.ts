import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Guard the class across the toolkit, daemon route packs and assembled HTTP host.
// Parse calls so multiline logs and interpolated caught errors cannot evade a line scan.
const metadata = new Set([
  'context.method.toUpperCase()', 'context.path', 'context.correlationId', 'context.source',
  'context.runId', 'context.phase', 'context.pid', 'context.provider', 'context.operation',
  'source', 'runId', 'correlationId', 'routine.id', 'attempt.routine.id',
  "providerParam || 'unknown'", 'timeoutMs', 'signal',
]);

function rawErrorLogs(source: string): string[] {
  const file = ts.createSourceFile('boundary.ts', source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && /^(?:console|logger)\.(?:error|warn|log)$/.test(node.expression.getText(file))) {
      node.arguments.forEach((arg, index) => {
        if (ts.isCallExpression(arg) && arg.expression.getText(file) === 'redactSecrets') return;
        // A fixed label or metadata prefix is safe; exception values must pass the shared redactor.
        const interpolation = ts.isTemplateExpression(arg) && arg.templateSpans.some(span => !metadata.has(span.expression.getText(file)));
        const label = ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg);
        if (index > 0 || !label || interpolation) violations.push(node.getText(file));
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function isSafeDiagnostic(node: ts.Node): boolean {
  // Property names do not establish trust: error.pluginId can itself contain a credential.
  return ts.isCallExpression(node) && ['redactSecrets', 'formatErrorForLog'].includes(node.expression.getText());
}

function containsRawError(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (isSafeDiagnostic(node)) return false;
  if (ts.isPropertyAssignment(node)) return containsRawError(node.initializer, names);
  if (ts.isConditionalExpression(node)) return containsRawError(node.whenTrue, names) || containsRawError(node.whenFalse, names);
  if (ts.isIdentifier(node) && names.has(node.text)) return true;
  return ts.forEachChild(node, child => containsRawError(child, names) || undefined) ?? false;
}

/** Promise rejection names are caller-chosen, just like catch-clause bindings. */
function collectRejectionNames(node: ts.Node, names: Set<string>): void {
  if (!ts.isCallExpression(node)) return;
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'catch') return;
  const handler = node.arguments[0];
  if (!handler) return;
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return;
  for (const parameter of handler.parameters) if (ts.isIdentifier(parameter.name)) names.add(parameter.name.text);
}

function rawCaughtErrorLogs(source: string, fileName = 'boundary.ts'): string[] {
  if (!/(?:console|logger)\s*\./.test(source)) return [];
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names = new Set(['err', 'error', 'failure', 'e', 'flashErr', 'cleanupError']);
  const collect = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) names.add(node.variableDeclaration.name.text);
    collectRejectionNames(node, names);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && /(?:^|\.)(?:console|logger)\.(?:error|warn|log)$/.test(node.expression.getText(file)) &&
        node.arguments.some(arg => containsRawError(arg, names))) violations.push(node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

describe('HTTP exception logging class guard', () => {
  it.each([
    'console.error(err)',
    'console.error(failure)',
    'logger.error({ err })',
    'console.error(`failed ${error}`)',
    'console.error(`failed ${failure}`)',
    'console.error("failed", String(error))',
    'console.error("failed", context.error)',
    'try { work(); } catch (message) { console.error(`failed ${message}`); }',
  ])('rejects raw exception logging: %s', source => {
    expect(rawErrorLogs(source)).not.toEqual([]);
  });

  it('requires the shared redactor at every exception log in HTTP packages', () => {
    const packages = fileURLToPath(new URL('../../../', import.meta.url));
    const violations = ['daemon', 'http-kit', 'server'].flatMap(name =>
      sources(join(packages, name, 'src')).flatMap(path => rawErrorLogs(readFileSync(path, 'utf8')).map(call => `${path}: ${call}`)),
    );
    expect(violations).toEqual([]);
  });

  it.each([
    'try { work(); } catch (unexpected) { console.warn("failed", unexpected); }',
    'try { work(); } catch (error) { console.error(error.pluginId); }',
    'try { work(); } catch (error) { console.warn(error.widgetName); }',
    'promise.catch(reason => console.error(reason))',
    'promise.catch((rejection) => console.warn({ error: rejection }))',
    'promise.catch(function (problem) { console.error(problem); })',
    'try { work(); } catch (message) { console.error(`failed ${message}`); }',
    'logger.warn({ message: `failed ${messageOf(error)}` })',
    'deps.logger.warn({ message: "cleanup failed" }, { error: cleanupError })',
    'console.error("host callback failed", failure.error)',
    'console.warn(`pool dropped: ${err.message}`)',
    'console.error("failed", error instanceof Error ? error.stack : String(error))',
  ])('rejects caught values across structured, JSX and callback logs: %s', source => {
    expect(rawCaughtErrorLogs(source)).not.toEqual([]);
  });

  it('accepts shared redaction while retaining diagnostic labels', () => {
    expect(rawCaughtErrorLogs('logger.warn({ message: "failed" }, { error: redactSecrets({ input: inspect(error) }, { redactPii: false }) })')).toEqual([]);
    expect(rawCaughtErrorLogs('promise.catch(reason => console.error("failed", formatErrorForLog({ error: reason })))')).toEqual([]);
    // Only the host callback's explicit identity fields form the label; its error is formatted.
    expect(rawCaughtErrorLogs('const onError = ({ pluginId, widgetName, error }) => console.warn(`Plugin ${pluginId} widget ${widgetName} failed`, formatErrorForLog({ error }));')).toEqual([]);
  });

  it('checks caught errors in JSX callbacks', () => {
    expect(rawCaughtErrorLogs('const view = <button onClick={() => { try { save(); } catch (unexpected) { console.error("save failed", unexpected); } }} />;', 'view.tsx')).not.toEqual([]);
  });

  it('requires shared redaction for caught errors across the remaining packages', () => {
    const packages = fileURLToPath(new URL('../../../', import.meta.url));
    const violations = ['core', 'cms', 'agent-runtime', 'mcp', 'db', 'chat', 'plugins', 'ui'].flatMap(name =>
      sources(join(packages, name, 'src')).flatMap(path => rawCaughtErrorLogs(readFileSync(path, 'utf8'), path).map(call => `${path}: ${call}`)),
    );
    expect(violations).toEqual([]);
  });
});
