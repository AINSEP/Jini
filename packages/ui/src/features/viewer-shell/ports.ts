/**
 * This feature is almost entirely presentational + pure logic (no fetch, no
 * project/file transport — see `packages/ui/archived provenance ledger` for why the
 * actual file-content loading, saving, and rendering pipelines were left
 * out of scope). The one thing every consumer still needs a real browser
 * API for is copy-to-clipboard, so that's the one injectable seam here,
 * following the same "context/callback + host-injected adapter, default a
 * real browser implementation" shape as `features/connectors/`'s
 * `authPendingStorage`/`authBridge`.
 *
 * Coverage: this file is `export interface` only — zero emitted executable
 * statements (verified via `@vitest/coverage-v8`: 0 statements, and its sole
 * reported "function"/"branch" is v8's own synthetic whole-module wrapper,
 * already counted as covered). Excluded from the coverage run rather than
 * padded with a no-op test.
 */
export interface ViewerClipboardPort {
  copyText(text: string): Promise<boolean>;
}

export interface ViewerShellDependencies {
  clipboard: ViewerClipboardPort;
}
