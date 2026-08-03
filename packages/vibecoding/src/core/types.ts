/**
 * @module core/types
 *
 * The vocabulary of a conversational authoring session, deliberately independent of *what* is
 * being authored.
 *
 * The whole design rests on one observation: every AI app-builder differs at exactly one place —
 * the artifact being edited. One tool edits a file tree; another edits a single markup document.
 * The conversation, the streaming, the undo, and the preview are the same in all of them. So this
 * package owns the loop and knows nothing about the target, which reaches it as a small port
 * (see `./target.ts`).
 *
 * Terminology: an artifact is made of **parts**. A part is the unit a model may be asked to
 * rewrite — a file for a file-tree host, a tagged region for a single-document host. Parts are
 * addressed by an opaque `PartId` that the host publishes; a caller never supplies a selector or a
 * path of its own devising.
 */

/**
 * An opaque handle to one editable part, minted and published by the host.
 *
 * It is an **allowlist entry, not a query**. A model or caller may only name an id the host has
 * already listed, which is what keeps a model-authored string from becoming a path traversal or an
 * arbitrary DOM selector. Hosts that expose filesystem paths or CSS selectors as ids are
 * responsible for validating them at the boundary before publishing them.
 */
export type PartId = string;

/** One editable part as advertised to the model, without its content. */
export interface PartRef {
  /** The host-published handle used to read or replace this part. */
  readonly id: PartId;
  /**
   * Optional host-meaningful category (e.g. a language, a region role). Purely descriptive —
   * the loop never branches on it, it exists so a host can shape its own prompt.
   */
  readonly kind?: string;
  /**
   * Optional human-facing label. Host-authored and therefore **untrusted** for display: treat it
   * as text, never as markup.
   */
  readonly label?: string;
}

/**
 * A point-in-time copy of every part's content.
 *
 * Deliberately a flat id → content map and nothing more. Two consequences worth stating, because
 * the reference implementation this shape was taken from conflates them:
 *
 * 1. **A snapshot restores DATA, never an execution environment.** A host with downstream state —
 *    a dev server, a build, an installed dependency tree — re-syncs itself *after* `restore`
 *    returns. If this type implied "and everything depending on these parts works again," it would
 *    be promising something it cannot deliver for any host but the simplest.
 * 2. It carries no ordering and no tree structure. A host that needs those reconstructs them from
 *    its own ids, which it minted and therefore understands.
 */
export interface Snapshot {
  /** Identifies this snapshot within a session. Assigned by the caller that took it. */
  readonly id: string;
  /** Every part's content at capture time, keyed by `PartId`. */
  readonly parts: Readonly<Record<PartId, string>>;
}

/** A host's verdict on a prospective change, returned by `EditTarget.validate`. */
export type ValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * Why the change was refused, phrased for the **model** rather than for a log. This string
       * is fed back as the next turn's input, so it should name the defect concretely
       * (e.g. "unclosed <section> — the document no longer parses") rather than say "invalid".
       */
      readonly reason: string;
    };

/** What happened to one `replace` attempt. */
export type ApplyOutcome =
  | { readonly status: "applied"; readonly id: PartId }
  | { readonly status: "rejected"; readonly id: PartId; readonly reason: string }
  | { readonly status: "failed"; readonly id: PartId; readonly error: Error };
