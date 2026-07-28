/**
 * @injini/renderers-react — the artifact renderer registry + sandboxed
 * srcDoc host. See `foundry/docs/jini-port/extraction-plan.md` §3 and
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §1 ("@injini/artifacts-react —
 * RendererRegistry", the pre-lock name for this package) for the design
 * this targets, and `source-map.md` for exact provenance.
 */
export type { ArtifactFile, ArtifactManifest, ArtifactKind, ArtifactRendererId, ArtifactExportKind, ArtifactStatus } from './types.js';

export {
  RendererRegistry,
  resolveArtifactManifest,
  type ArtifactRenderer,
  type ArtifactRendererContext,
  type ArtifactRenderMatch,
} from './registry.js';

export {
  HtmlRenderer,
  MarkdownRenderer,
  SvgRenderer,
  ReactComponentRenderer,
  renderMarkdownToSafeHtml,
  createDefaultRendererRegistry,
} from './renderers/index.js';

export { highlightCode } from './shiki.js';

export {
  shouldUrlLoadHtmlPreview,
  parseForceInline,
  htmlNeedsFocusGuard,
  htmlNeedsSandboxShim,
  type UrlLoadDecision,
} from './url-load-decision.js';

export {
  buildSrcDoc,
  buildLazySrcDocTransport,
  canActivateSrcDocTransport,
  sanitizeTitleInDoc,
  sanitizePreviewTitle,
  DEFAULT_SRC_DOC_CSP,
  injectAfterHeadOpen,
  injectBeforeHeadEnd,
  injectBeforeBodyEnd,
  applySrcDocBridges,
  type BuildSrcDocOptions,
  type SrcDocActivationInputs,
  type SrcDocBridge,
  type SrcDocBridgeContext,
} from './srcdoc/index.js';

export { I18nProvider, useI18n, useT, type I18nContextValue, type TranslationDict, type TranslationVars } from './react/i18n.js';
export { SrcDocSandbox, type SrcDocSandboxProps } from './react/components/SrcDocSandbox.js';
export {
  ArtifactView,
  type ArtifactViewProps,
  type ArtifactViewSlot,
  type ArtifactViewSlotProps,
  type ArtifactViewSlots,
} from './react/components/ArtifactView.js';

export * from './annotation-canvas/index.js';

/**
 * `html-utils.ts`/`sandboxed-document.ts` (below) independently ported the
 * *same* generic string-splice helpers as `./srcdoc/build.ts` above — both
 * trace back to OD's `runtime/srcdoc.ts` `injectAfterHeadOpen`/
 * `injectBeforeHeadEnd`/`injectBeforeBodyEnd`, built in parallel on two
 * branches that never saw each other. They are not behaviorally identical:
 * `./srcdoc/index.js`'s versions (re-exported above under their original
 * names — they're already the more widely-used ones, wired through
 * `buildSrcDoc`'s CSP/shim/focus-guard injection and every `SrcDocBridge`)
 * add a `DOMParser`-based fallback for documents with no `<head>`/`<body>`
 * tag *and* no matching close tag at all; `html-utils.ts`'s versions do a
 * plain prepend/append in that same edge case instead. Both fallback
 * behaviors are real and independently tested (`html-utils.test.ts` vs.
 * `srcdoc/build.test.ts`'s "falls back to DOMParser" cases), so rather than
 * pick a winner or let one silently shadow the other under the shared name,
 * `html-utils.ts`'s versions are re-exported here under a `StringOnly`
 * suffix — this is the exact set `sandboxed-document.ts` (this package's
 * *other* independently-built sandboxed-iframe core, consumed today by
 * `@injini/ui`'s `features/html-viewer`) relies on internally, unchanged.
 */
export { escapeHtmlAttribute } from './html-utils.js';
export {
  injectAfterHeadOpen as injectAfterHeadOpenStringOnly,
  injectBeforeHeadEnd as injectBeforeHeadEndStringOnly,
  injectBeforeBodyEnd as injectBeforeBodyEndStringOnly,
} from './html-utils.js';

export {
  isFullHtmlDocument,
  wrapFragmentAsDocument,
  injectBaseHref,
  buildStorageShimScript,
  buildFocusGuardScript,
  buildSandboxedDocument,
} from './sandboxed-document.js';
export type { SandboxedDocumentOptions, SandboxedDocumentResult, SandboxBridgeMessage, SandboxBridgeHandler } from './types.js';
export { useSandboxBridge, type UseSandboxBridgeOptions, type SandboxBridge } from './sandbox-bridge.js';
export {
  buildSandboxedPreviewPage,
  openSandboxedPreviewInNewTab,
  type NewTabPreviewOptions,
} from './new-tab-preview.js';

export * from './preview-modal-shell/index.js';
