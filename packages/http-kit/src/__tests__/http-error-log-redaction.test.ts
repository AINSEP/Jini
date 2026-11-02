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
  "providerParam || 'unknown'", 'timeoutMs', 'signal', 'message',
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
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
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
});
