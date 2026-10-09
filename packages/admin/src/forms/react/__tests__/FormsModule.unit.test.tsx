import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Suspense } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { createAdmin } from '../../../core/module/create-admin.js';
import { AdminApiError } from '../../../core/transport/errors.js';
import { createMemoryFormsApi } from '../../adapters/memory.js';
import { forms } from '../index.js';

describe('Forms module list API failure regression', () => {
  it('loads the list eagerly so its API read cannot queue behind a native dynamic import', () => {
    // jsdom resolves native imports immediately; rendering alone cannot reproduce a browser's
    // exhausted socket pool. Pin the eager import as well as the real failure rendering below.
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.ts'), 'utf8');
    const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
    const eagerImports = ast.statements.filter(ts.isImportDeclaration).filter(statement =>
      ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === './pages/FormsList.js'
      && statement.importClause && !statement.importClause.isTypeOnly);
    expect(eagerImports).toHaveLength(1);
    const listImports: ts.CallExpression[] = [];
    const listViews: ts.PropertyAssignment[] = [];
    function visit(node: ts.Node): void {
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'list') listViews.push(node);
      ts.forEachChild(node, visit);
    }
    function findImports(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) listImports.push(node);
      ts.forEachChild(node, findImports);
    }
    visit(ast);
    expect(listViews).toHaveLength(1);
    listViews.forEach(findImports);
    expect(listImports).toEqual([]);
  });

  it.each([
    { status: 503, message: 'Forms API unavailable' },
    { status: 0, message: 'Forms API request timed out' },
  ])('renders the visible error when the API read rejects: $message', async ({ status, message }) => {
    const memory = createMemoryFormsApi({});
    let rejectRead!: (error: Error) => void;
    const listFormDefinitions = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectRead = reject; }));
    const module = forms({});
    // The Provider scopes the bound definition by identity, not the factory's React wrapper.
    const admin = createAdmin({ modules: [module.react.module], ports: {
      formsApi: { ...memory, listFormDefinitions }, formsTrash: memory.trash,
    } }, { permissions: ['admin.forms.manage'] });
    const { Page, tabs } = module.react.pages.list;
    const description = admin.describe().pages.find(page => page.id === 'forms.list')!;
    try {
      render(<FetchQueryProvider><module.react.Provider admin={admin}>
        <Suspense fallback={<p>Loading module…</p>}><Page tabs={tabs} description={description} /></Suspense>
      </module.react.Provider></FetchQueryProvider>);
      await waitFor(() => expect(listFormDefinitions).toHaveBeenCalledTimes(1));
      expect(screen.getByText('Loading forms…')).toBeVisible();

      await act(async () => { rejectRead(new AdminApiError({ status, message })); });

      const notice = await screen.findByText(message);
      expect(notice).toBeVisible();
      expect(notice).toHaveClass('notice', 'error');
      expect(screen.queryByText('Loading forms…')).not.toBeInTheDocument();
      expect(screen.queryByText('Loading module…')).not.toBeInTheDocument();
    } finally { admin.dispose(); }
  });
});
