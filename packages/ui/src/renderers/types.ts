/**
 * `ArtifactKind`/`ArtifactRendererId`/`ArtifactExportKind`/`ArtifactStatus`/
 * `ArtifactManifest` below were previously re-exported from `@jini-ai/chat`.
 * They are now owned here instead: a renderer registry package must not
 * depend on a chat package (folding this package into `@jini-ai/ui`, which
 * `@jini-ai/chat` already depends on, would otherwise create a `ui ↔ chat`
 * cycle). Shapes are copied verbatim from `@jini-ai/chat`'s
 * `src/core/util/types.ts` — keep the two in sync by hand if that shape
 * changes.
 */
export type ArtifactKind =
  | 'html'
  | 'deck'
  | 'react-component'
  | 'markdown-document'
  | 'svg'
  | 'diagram'
  | 'code-snippet'
  | 'mini-app'
  | 'design-system';

export type ArtifactRendererId =
  | 'html'
  | 'deck-html'
  | 'react-component'
  | 'markdown'
  | 'svg'
  | 'diagram'
  | 'code'
  | 'mini-app'
  | 'design-system';

export type ArtifactExportKind = 'html' | 'pdf' | 'zip' | 'jsx' | 'md' | 'svg' | 'txt';

export type ArtifactStatus = 'streaming' | 'complete' | 'error';

/**
 * The sidecar manifest an artifact-producing turn writes alongside its
 * generated file, describing how to render/export it. Generic across
 * artifact kinds — a host's own artifact-file type carries this manifest,
 * not the other way around (see `ArtifactFile` below).
 */
export interface ArtifactManifest {
  version: 1;
  kind: ArtifactKind;
  title: string;
  entry: string;
  renderer: ArtifactRendererId;
  /** Optional for backward compatibility with older manifests; treat missing as `'complete'`. */
  status?: ArtifactStatus | undefined;
  exports: ArtifactExportKind[];
  /** Optional primary-entry hint for multi-file outputs; fall back to renderable-file heuristics when omitted. */
  primary?: string | boolean | undefined;
  /** Reserved for future multi-file artifact packaging; not yet populated by any known generator. */
  supportingFiles?: string[] | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  sourceSkillId?: string | undefined;
  designSystemId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface SandboxedDocumentOptions {
  /**
   * Value for the document's `<base href>`, so relative asset/link
   * references in the artifact HTML resolve against it instead of the
   * host page's own URL. Omit to leave relative references as-is.
   */
  baseHref?: string;
  /**
   * Shim `localStorage`/`sessionStorage` with an in-memory store when the
   * real Storage API throws. A sandboxed iframe using
   * `sandbox="allow-scripts"` without `allow-same-origin` raises a
   * `SecurityError` on first access to either — many hand-written or
   * model-generated pages call `localStorage.getItem(...)` at the top of
   * an IIFE with no try/catch, so without this shim the whole script
   * aborts and the page never renders. Also installs a click-time
   * interceptor for `<a href>` clicks so hash-only links scroll within the
   * document instead of navigating the sandboxed frame, and
   * `target="_blank"` links open through `window.open` with a scheme
   * allow-list instead of being silently blocked by the sandbox. Defaults
   * to `true`.
   */
  storageShim?: boolean;
  /**
   * Suppress `focus()` calls (on `window` or any element) that aren't the
   * direct result of a real pointer/keyboard event within the last second.
   * Without this, embedded content can call `.focus()` on load or on a
   * timer and steal keyboard focus away from the host page around it.
   * Defaults to `false` — most hosts only need this for content mounted
   * alongside other interactive UI (e.g. a toolbar) that the sandboxed
   * frame shouldn't be able to steal focus from.
   */
  focusGuard?: boolean;
}

export interface SandboxedDocumentResult {
  /** The final HTML string, ready to assign to an iframe's `srcdoc`. */
  html: string;
  /** Whether the input was already a full `<!doctype>`/`<html>` document (vs. a bare fragment that got wrapped). */
  isFullDocument: boolean;
}

export interface SandboxBridgeMessage {
  type: string;
  [key: string]: unknown;
}

export type SandboxBridgeHandler<M extends SandboxBridgeMessage = SandboxBridgeMessage> = (
  message: M,
) => void;

/**
 * A host's artifact/file representation, generified from a product's own
 * project-file type. A host's real file type carries far more (ids,
 * timestamps, storage refs, …) — this is only the shape the renderer
 * registry needs to resolve and render one.
 */
export interface ArtifactFile {
  name: string;
  /** Host-defined coarse file kind (e.g. 'html' | 'text' | 'image' | 'sketch'). Not the same vocabulary as `ArtifactManifest.kind`. */
  kind: string;
  content?: string | undefined;
  url?: string | undefined;
  manifest?: ArtifactManifest | undefined;
}
