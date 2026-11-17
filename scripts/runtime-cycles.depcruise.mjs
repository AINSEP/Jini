// Runtime module cycles in the engine packages. Read by scripts/check-runtime-cycles.ts (R14 in
// `pnpm guard`), never by `pnpm quality:depcruise` (that report-only config counts type edges too).
//
// "Runtime" means: the import statement is still in the JavaScript the package build emits. Every
// package inherits `verbatimModuleSyntax` from tsconfig.base.json, so:
//   import type { X } from './x.js'    -> dropped by the compiler, not an edge here
//   import { type X } from './x.js'    -> emitted as `import {} from './x.js'`, still loads ./x.js
//   import { unused } from './x.js'    -> kept, still loads ./x.js
// Two settings make dependency-cruiser agree with the compiler, and both are required:
//   - `tsPreCompilationDeps: false` reads imports AFTER compilation. With `true` the inline-`type`
//     form is tagged "type-only", and a type filter would hide an import that really loads a module.
//   - `tsConfig` must name the base config. Without it the files are compiled without
//     `verbatimModuleSyntax` and the kept `import {}` statements are dropped.
// So there is no `dependencyTypesNot` filter here, on purpose.
const tests = '(^|/)__tests__/|\\.(test|spec|typecheck)\\.[cm]?tsx?$';
export default {
  forbidden: [
    {
      name: 'no-runtime-circular',
      severity: 'error',
      comment: 'Two or more modules load each other at runtime. Move what they share into a leaf file that imports neither, or make a type import a statement-level `import type`.',
      from: { pathNot: tests },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: `(^|/)(__tests__|dist|node_modules)/|\\.(test|spec|typecheck)\\.[cm]?tsx?$` },
    tsPreCompilationDeps: false,
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
};
