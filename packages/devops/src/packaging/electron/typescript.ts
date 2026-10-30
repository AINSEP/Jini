import type ts from 'typescript';
import type { ImportReaderPort } from './ports.js';

/** Bind the maintained TypeScript parser supplied by the host; no parser dependency at runtime. */
export function createTypeScriptImportReader({ compiler }: { compiler: typeof ts }): ImportReaderPort {
  return { imports({ file, source }) {
    const tree = compiler.createSourceFile(file, source, compiler.ScriptTarget.Latest, false, compiler.ScriptKind.JS);
    const found: string[] = [];
    function moduleSpecifierOf(node: ts.Node): ts.Expression | undefined {
      if (compiler.isImportDeclaration(node) || compiler.isExportDeclaration(node)) return node.moduleSpecifier;
      if (compiler.isCallExpression(node) && node.expression.kind === compiler.SyntaxKind.ImportKeyword) return node.arguments[0];
      return undefined;
    }
    function visit(node: ts.Node): void {
      const literal = moduleSpecifierOf(node);
      if (literal !== undefined && compiler.isStringLiteral(literal)) found.push(literal.text);
      compiler.forEachChild(node, visit);
    }
    visit(tree);
    return found;
  } };
}
