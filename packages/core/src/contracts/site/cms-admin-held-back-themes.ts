/**
 * @file What `use-held-back-themes.hooks.ts` needs from the outside world, as an interface rather
 * than a direct `lib/api` import — same `useX(dependencies)` / wired-hook split as `themes-port.hooks.ts`.
 * Its own port, not part of `ThemesPort`: held-back themes live in the import quarantine, a different
 * resource from the registry of installed themes. Every method rejects with an `ApiError`.
 */

/** One theme set aside by a site import. */
export interface HeldBackTheme {
  /** Quarantine id, with a slash (`static/foo`); the key for check and restore. */
  id: string;
  /** The manifest's name, else the folder name. */
  name: string;
  tier: "static" | "declarative";
  /** It came from the site's `__original-themes__` catalogue rather than its live themes. */
  original: boolean;
  files: number;
  bytes: number;
}

/** The theme the site had chosen before import swapped it for the default one. */
export interface ChosenThemeHeldBack {
  themeId: string;
  name: string;
  /** The theme visitors see instead. */
  fallbackThemeId: string;
}

export interface HeldBackThemesList {
  themes: HeldBackTheme[];
  /** `null` unless the chosen theme is still held back and the owner has not picked another since. */
  chosenThemeHeldBack: ChosenThemeHeldBack | null;
}

/** The server's fresh safety check of one held-back theme. */
export interface HeldBackCheckResult {
  themeId: string;
  passes: boolean;
  /** Plain-words reasons; empty when `passes`. */
  problems: string[];
  /** Fingerprint of the checked files — only when `passes`; restore must echo it back. */
  digest: string | null;
  /** A live theme folder already exists where this one would go. */
  nameTaken: boolean;
  /** The plan the approval card confirms — only when `passes`; `null` otherwise. */
  approval: { planId: string; planHash: string } | null;
}

/** The server's record of the approval card's answer; only an approval carries a token. */
export interface HeldBackApprovalResult {
  approved: boolean;
  /** Single-use, bound to this person, workspace, theme and digest. */
  confirmationToken?: string;
}

export interface HeldBackRestoreResult {
  theme: { id: string; name: string; status: "valid" | "invalid" };
  restoredFrom: string;
}

export interface HeldBackThemesPort {
  /** The held-back themes, plus the chosen-theme marker when the owner's pick was among them. */
  list(): Promise<HeldBackThemesList>;
  /** Re-run the safety checks on one theme. Changes nothing. */
  check(required: { themeId: string }, optional?: Record<string, never>): Promise<HeldBackCheckResult>;
  /** Record the approval card's "Restore" for the check's plan; the server mints the approval token. */
  approveRestore(required: { themeId: string; planId: string; planHash: string }, optional?: Record<string, never>): Promise<HeldBackApprovalResult>;
  /** Move a checked theme to its live place: `approvedDigest` is the version check, `confirmationToken` the approval. */
  restore(required: { themeId: string; approvedDigest: string; confirmationToken: string }, optional?: Record<string, never>): Promise<HeldBackRestoreResult>;
}
