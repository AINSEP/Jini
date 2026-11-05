<!-- Source: Addy Osmani / agent-skills / code-simplification -->

# The Rule Of 500

If a refactoring would touch more than 500 lines, invest in automation instead of relying on manual edits.

Large manual refactors create review fatigue, inconsistent transformations, and subtle missed cases. Automation makes the change repeatable, reviewable, and easier to validate.

## Codemods vs Manual Refactors

| Approach | Use when |
|---|---|
| Manual refactor | The change is small, localized, semantic, or requires judgment at each edit |
| Codemod | The same structural change repeats across many files or call sites |
| AST transform | Text search is too risky because syntax, nesting, imports, or type structure matter |

For JavaScript and TypeScript, `jscodeshift` is the standard codemod tool.

## Codemod Structure

A codemod usually follows this shape:

```js
export default function transformer(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  root
    .find(j.Identifier, { name: 'oldName' })
    .replaceWith(() => j.identifier('newName'));

  return root.toSource();
}
```

Typical steps:

1. Parse the source into an AST.
2. Find the pattern to change.
3. Transform matching nodes.
4. Print the updated source.
5. Run tests and review the generated diff.

## Balance Failure Mode

Simplification can go too far. Watch for these traps:

- Inlining too aggressively until intent disappears.
- Combining unrelated logic because it looks similar.
- Removing extensibility abstractions that protect real variation.
- Collapsing boundaries that made ownership or testing clearer.

Good simplification removes accidental complexity while preserving useful structure.

## Scope To What Changed

Avoid drive-by refactors. Refactor the area needed for the current change and leave unrelated cleanup for separate work. Smaller scoped diffs are easier to review, safer to roll back, and less likely to mix behavior changes with cleanup.
