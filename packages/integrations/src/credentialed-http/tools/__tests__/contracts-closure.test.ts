/** @file EXTRACT-S8-X: pure consumer contracts, declaration notes and host-vocabulary closure. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'vitest';
import ts from 'typescript';

function read(name: string) {
  const names = name === 'tool-registrations.ts'
    ? readdirSync(new URL('..', import.meta.url)).filter(file => file.endsWith('.ts'))
    : [name];
  const text = names.map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  return { text, source: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true) };
}

test('consumer-only operations import core types only, with no runtime imports or hidden host defaults', () => {
  const { text, source } = read('credential-tool-operations.ts');
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      assert.equal(statement.importClause?.isTypeOnly, true);
      assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
      assert.match(statement.moduleSpecifier.text, /^@jini-ai\/core(?:\/|$)/);
    } else assert.ok(ts.isInterfaceDeclaration(statement), statement.getText(source));
  }
  assert.doesNotMatch(text, /@tovu\/|#src\/|@jini-ai\/(?!core)|['"]tovu['"]|CUSTOM_CREDENTIALS|custom_credential_|https?:\/\//);
});

test('every exported consumer contract carries its own second-host note, preserved in declarations', () => {
  for (const name of ['credential-tool-operations.ts', 'credential-tool-host.ts']) {
    const { text, source } = read(name);
    const declarations = ts.transpileDeclaration(text, { fileName: name, compilerOptions: { removeComments: false } });
    assert.deepEqual(declarations.diagnostics ?? [], []);
    const emitted = ts.createSourceFile(name.replace('.ts', '.d.ts'), declarations.outputText, ts.ScriptTarget.Latest, true);
    for (const declaration of [source, emitted]) {
      for (const statement of declaration.statements.filter(ts.isInterfaceDeclaration)) {
        const comments = declaration.text.slice(statement.getFullStart(), statement.getStart(declaration));
        assert.match(comments, /@agent-note/, `${name}: ${statement.name.text} must carry declaration-local obligations`);
      }
    }
  }
});

test('the credential-port ordering note is attached to CustomCredentialToolPorts itself', () => {
  const { text, source } = read('credential-tool-host.ts');
  const declaration = source.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'CustomCredentialToolPorts');
  assert.ok(declaration);
  const comment = text.slice(declaration.getFullStart(), declaration.getStart(source));
  assert.match(comment, /resolveTarget.*never decrypts/);
  assert.match(comment, /SAME provider object/); assert.match(comment, /EXACT plan/); assert.match(comment, /Aborted → no commit/);
  assert.doesNotMatch(comment, /The secret-card functions/);
});

test('the prospective moved handler/helper closure has no product literal defaults or Tovu dependency types', () => {
  const { source } = read('tool-registrations.ts');
  const names = [
    'createCredentialSaveHandlers', 'createCredentialToolRegistrations', 'openCreateCard', 'saveCreateCard', 'saveSetToken',
    'probeCardBeforeSave', 'readCreateCredentialPrefill', 'safeCredentialLabel', 'deriveCreateCredentialSubmission',
    'mapCreateCredentialError', 'rejectUnexpectedSetUsernameFields', 'requireUsernameOrClearSentinel', 'rejectUnexpectedSetTokenFields',
    'makeModelFacingCredentialedRequest', 'performRepositoryFilesWrite',
  ];
  for (const name of names) {
    const fn = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
    assert.ok(fn && ts.isFunctionDeclaration(fn) && fn.body, name);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node)) assert.doesNotMatch(node.text, /tovu|custom_credential_|custom-credentials|credential_save|features\/|https?:\/\//i, `${name}: host vocabulary must be supplied`);
      if (ts.isIdentifier(node)) assert.notEqual(node.text, 'CustomCredentialsToolDeps', `${name}: actor contract must not name Tovu route types`);
      ts.forEachChild(node, visit);
    };
    visit(fn);
  }
  for (const name of ['ValidatedWriteFilesInput', 'WriteFilesResult', 'SetTokenResult', 'SetTokenAnswerContext', 'RawCreateCredentialFields', 'CreateCredentialSubmission', 'CreateCardFailure', 'CreateCredentialResult']) {
    const statement = source.statements.find(s => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === name);
    assert.ok(statement, name);
    assert.match(source.text.slice(statement.getFullStart(), statement.getStart(source)), /@agent-note/, name);
  }
});
