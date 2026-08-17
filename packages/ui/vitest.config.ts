import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Package-wide default is jsdom (most tests in this package touch the
    // DOM). The few tests that assert real SSR/no-DOM behavior (e.g.
    // utils/dom-subscriptions, utils/zip) opt back into Node per-file via a
    // `// @vitest-environment node` pragma — see packages/ui/source-map.md.
    environment: 'jsdom',
    // `src/__tests__/features/**`, `src/__tests__/utils/**`, and
    // `src/__tests__/rules.test.ts` are the former `@jini-ai/ui-core`
    // package's own test tree, folded in here unchanged (2026-08-01) along
    // with the framework-free source it covers (now reachable at
    // `./core`). Routed to `node` by GLOB rather than per-file pragma, on
    // purpose: `@jini-ai/ui-core` enforced its no-DOM boundary by having no
    // `jsdom` environment to fall back to at all, so a DOM-dependent test
    // landing there failed loudly. A per-file pragma only protects files
    // that remember to carry it; a new test added to this tree tomorrow
    // gets `node` automatically and keeps failing loudly if it reaches for
    // `window`, same as before the fold-in. Does not cover
    // `src/__tests__/index.test.ts` (the package's own pre-existing root
    // barrel test) — that one imports feature barrels that re-export React
    // components, so it needs jsdom same as always.
    environmentMatchGlobs: [
      ['src/__tests__/features/**', 'node'],
      ['src/__tests__/utils/**', 'node'],
      ['src/__tests__/rules.test.ts', 'node'],
    ],
    setupFiles: ['./vitest.setup.ts'],
    server: {
      // @excalidraw/excalidraw's dev build ships extensionless deep imports
      // (e.g. `roughjs/bin/rough`) that assume a bundler's resolver — Vitest's
      // default SSR path hands externalized deps straight to Node's loader,
      // which requires exact extensions and fails to resolve them. Routing it
      // (and its own dependency tree) through Vite's transform pipeline
      // instead resolves those imports correctly.
      deps: {
        inline: [/@excalidraw\/excalidraw/, /roughjs/],
      },
    },
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 9.5 method).
      reporter: ['text', 'json-summary', 'json'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Genuinely zero-executable-statement files: pure `interface`/`type`
        // declarations that fully erase at compile time (verified via
        // `grep -nE '^(export )?(const|function|class|let|var) '` finding no
        // runtime declarations in any of these — see `settings-dialog`'s
        // extraction audit). A file with nothing to execute is never loaded
        // by any test, so v8 reports it as 0% rather than N/A; excluding it
        // here is the documented-reason carve-out, not a coverage dodge.
        // Scoped to `settings-dialog`'s own `types.ts` files (not a
        // package-wide glob) because at least one other feature's
        // `ports.ts` (`features/observability/ports.ts`) DOES carry a real
        // runtime declaration and must stay covered.
        'src/features/settings-dialog/types.ts',
        'src/features/settings-dialog/tabs/*/types.ts',
        'src/features/settings-dialog/tabs/integrations/ports.ts',
        // features/tab-strip/types.ts: same carve-out — `export type`/
        // `export interface` only (verified via the same grep), no runtime
        // declarations. features/tab-strip/ports.ts is NOT excluded: it
        // carries a real runtime declaration (`noopTabStripHaptics`) and
        // is fully covered by dependencies.test.ts/index.test.ts.
        'src/features/tab-strip/types.ts',
        // Same carve-out: `features/html-viewer/types.ts` (plain
        // `DeckSlideState`/`DeckNavigateAction` type shapes) and its
        // `ports.ts` (`FullscreenPort`/`NewTabPreviewPort`/
        // `HtmlViewerDependencies` — interfaces only, unlike
        // `features/observability/ports.ts` which carries a real
        // `noopSafetyEventReporter` runtime export) both verified
        // zero-runtime-declaration.
        'src/features/html-viewer/types.ts',
        'src/features/html-viewer/ports.ts',
        // list-detail-panel/types.ts is pure `interface` declarations, zero
        // runtime statements (verified via the same
        // `grep -nE '^(export )?(const|function|class|let|var) '` check).
        'src/features/list-detail-panel/types.ts',
        // 2026-07-22 audit pass: 20 more `ports.ts`/`types.ts` files across
        // the package, each re-verified zero-runtime-declaration via the
        // same `grep -nE '^(export )?(const|function|class|let|var) '`
        // check (plus a broader `enum|default` sweep) before being added
        // here — see packages/ui/source-map.md's dated entry for the full
        // file-by-file record.
        'src/features/asset-grid/ports.ts',
        'src/features/asset-grid/types.ts',
        'src/features/asset-tree-browser/ports.ts',
        'src/features/asset-tree-browser/types.ts',
        'src/features/browser-chrome/ports.ts',
        'src/features/browser-chrome/types.ts',
        'src/features/connectors/ports.ts',
        'src/features/connectors/types.ts',
        'src/features/i18n/types.ts',
        'src/features/memory/ports.ts',
        'src/features/memory/types.ts',
        'src/features/mention-autocomplete/types.ts',
        'src/features/progress-card/types.ts',
        'src/features/schedule-picker/types.ts',
        'src/features/sketch-editor/ports.ts',
        'src/features/sketch-editor/types.ts',
        'src/features/version-manager/ports.ts',
        'src/features/version-manager/types.ts',
        'src/features/viewer-shell/ports.ts',
        'src/features/viewer-shell/types.ts',
        // Same carve-out for source-config-list: types.ts is interface-only,
        // and ports.ts here is ALSO interface-only (unlike
        // features/observability/ports.ts above, it has no runtime binding
        // helper) — verified with the same grep before excluding.
        'src/features/source-config-list/types.ts',
        'src/features/source-config-list/ports.ts',
        // Same carve-out for resource-dashboard: types.ts and ports.ts are
        // both interface-only (two separate port interfaces, ResourceBoardPort
        // and ResourceRowListPort, but no runtime binding helper lives in
        // ports.ts itself — that's dependencies.ts, which IS covered) —
        // verified with the same grep before excluding.
        'src/features/resource-dashboard/types.ts',
        'src/features/resource-dashboard/ports.ts',
        // lexical-rich-text-editor/types.ts is pure `interface`/`type`
        // declarations, zero runtime statements (same verification check).
        'src/features/lexical-rich-text-editor/types.ts',
        // iframe-pool/types.ts is likewise pure `interface` declarations,
        // zero runtime statements (same verification grep).
        'src/features/iframe-pool/types.ts',
        // command-palette/{types,ports}.ts are likewise pure `interface`
        // declarations, zero runtime statements (same verification grep).
        'src/features/command-palette/types.ts',
        'src/features/command-palette/ports.ts',
        // tab-launcher-menu/types.ts is likewise pure `interface`/`type`
        // declarations, zero runtime statements (same verification grep).
        'src/features/tab-launcher-menu/types.ts',
        // revision-review/types.ts is likewise pure `interface`/`type`
        // declarations, zero runtime statements (same verification grep).
        'src/features/revision-review/types.ts',
        // file-dropzone/types.ts is likewise pure `type`/`interface`
        // declarations, zero runtime statements (same grep check).
        'src/features/file-dropzone/types.ts',
        // Zero emitted executable statements — `export interface`/type-only
        // declarations that fully erase at compile time (verified via
        // `grep -nE '^(export )?(const|function|class|let|var) '` finding
        // nothing). A file with nothing to execute is never loaded by any
        // test, so v8 reports it as 0% rather than N/A. Carried over from
        // the former standalone `@jini-ai/renderers-react` package's own
        // vitest.config.ts when it moved into this package as `./renderers`
        // (2026-08-09) — the same documented carve-out this file already
        // uses for the `settings-dialog` feature's `types.ts` files, above.
        'src/renderers/types.ts',
        'src/renderers/preview-modal-shell/types.ts',
      ],
      // Measured 2026-07-22 (audit fix — coverage-hardening pass): 99.98%
      // statements / ~99.86-99.88% branches / 100% functions / 99.98% lines
      // across the whole package (17723/17726 statements, ~6863-6865/
      // ~6872-6873 branches, 1193/1193 functions, 17723/17726 lines). This
      // is not a rounded-down margin — it is the real number after closing
      // every genuinely reachable gap with real tests or real refactors;
      // the handful of residual uncovered branches are each individually
      // documented as provably unreachable (with proof, not just "hard to
      // hit") right at the call site and in this package's source-map.md's
      // dated entry: `browser/useGlobalKeydown.ts` (React DOM itself
      // requires `window` to exist before this hook's effect can ever
      // run), `hooks/useConnectorAuthorization.ts` (`authError[id]` and
      // `pending[id]` can never both be set for the same id — proven via
      // this hook's own state-transition invariants),
      // `features/observability/stuck-run.ts` /
      // `features/observability/white-screen.ts` (timer/observer guards
      // that can never see a stale flag because every setter that flips the
      // flag also synchronously cancels the timer/observer in the same
      // update), and `utils/smooth-scroll-to-top.ts` (this file's one and
      // only bezier curve's derivative never approaches its 1e-6 guard,
      // verified by sampling 1,000,001 points across its whole domain). The
      // branches total/covered count itself is not perfectly deterministic
      // run-to-run (observed 6872/6863 through 6873/6865 across three
      // consecutive re-runs of the identical source tree, no test content
      // changed) — v8's coverage collector produces small ±1-2 branch count
      // jitter under this package's parallel-worker test execution. The
      // `branches` threshold below is set with a small safety margin under
      // the observed floor so real-but-noisy measurement variance never
      // trips the gate; it is not masking any actual uncovered code path.
      thresholds: {
        statements: 99.98,
        branches: 99.8,
        functions: 100,
        lines: 99.98,
      },
    },
  },
});
