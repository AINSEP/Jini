import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { test } from 'vitest';

/** Uses the real p1 closure so a newly re-exported module cannot silently evade the purity check. */
test('./host is universal and never evaluates executable source', async () => {
  const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  // Indirect import keeps repository guard source out of the published package's rootDir.
  const guardUrl = pathToFileURL(join(repoRoot, 'scripts/check-subpath-isolation.ts')).href;
  const { auditSubpathIsolation } = await import(guardUrl) as {
    auditSubpathIsolation(input: { repoRoot: string }): {
      closures: Array<{ package: string; subpath: string; files: string[] }>;
      findings: Array<{ package: string; kind: string; reason: string }>;
    };
  };
  const audit = auditSubpathIsolation({ repoRoot });
  const closure = audit.closures.find((entry) => entry.package === '@jini-ai/plugins' && entry.subpath === './host');
  assert.ok(closure, 'p1 must resolve the actual ./host export');
  assert.deepEqual(audit.findings.filter((finding) => finding.package === '@jini-ai/plugins'), []);
  for (const file of closure.files) {
    const source = ts.createSourceFile(file, readFileSync(join(repoRoot, file), 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        assert.equal(node.moduleSpecifier.text.startsWith('node:'), false, file);
      }
      if (ts.isCallExpression(node)) {
        assert.equal(node.expression.kind === ts.SyntaxKind.ImportKeyword, false, file);
        assert.equal(ts.isIdentifier(node.expression) && node.expression.text === 'eval', false, file);
      }
      if (ts.isNewExpression(node)) assert.equal(ts.isIdentifier(node.expression) && node.expression.text === 'Function', false, file);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
