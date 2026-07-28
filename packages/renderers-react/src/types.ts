import type { ArtifactManifest } from '@injini/chat-core';

export type { ArtifactManifest, ArtifactKind, ArtifactRendererId, ArtifactExportKind, ArtifactStatus } from '@injini/chat-core';

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
