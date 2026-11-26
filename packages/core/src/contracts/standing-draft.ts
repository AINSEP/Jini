/** The fields a standing draft carries — see `PostAutosaveSnapshot`'s own server-side doc for why
 *  `status` is deliberately absent (a draft must never change whether a row is live). */
export type StandingDraftAutosaveInput =
  | { bodyFormat: "doc"; bodyJson: Record<string, unknown>; title: string; slug: string; baseVersion: number }
  | { bodyFormat: "html"; bodyHtml: string; title: string; slug: string; baseVersion: number };

export interface StandingDraftAutosaveSnapshot {
  bodyFormat: "doc" | "html";
  bodyJson?: Record<string, unknown>;
  bodyHtml?: string;
  title: string;
  slug: string;
  baseVersion: number;
  savedAt: string;
  savedByPrincipalId: string;
  /** Fresh server timestamp used only for the explicit recovery comparison. */
  serverUpdatedAt?: string | undefined;
}

/** A write the server refused because the row moved on — see this file's header. Carries the
 *  operator's refused text itself, not just a flag: it is the copy nothing else on the client has
 *  a claim to, and a conflict notice that drops the work would be worse than the silent drop. */
export interface StandingDraftStaleBasis {
  /** The `baseVersion` the refused draft was built on. The gate lifts when a later
   *  `scheduleAutosave` arrives on a different one. */
  baseVersion: number;
  /** Exactly what was refused. */
  draft: StandingDraftAutosaveInput;
}

