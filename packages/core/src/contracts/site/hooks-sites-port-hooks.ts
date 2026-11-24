/**
 * @file The admin Sites screen's wire shapes and the port its hooks read sites through.
 * Types only: the host keeps the HTTP client, the route handlers and the rules; these shapes carry
 * no host names.
 */

/** One row of the admin Sites screen — mirrors `SiteListEntry` in
 *  the host's site registry. Only directories carrying a valid
 *  `.site-meta.json` commit marker appear; see {@link AdminSiteBinding.listed} for why that matters. */
export interface AdminSiteListEntry {
  /** Folder name under `sites/` — the id every write in this feature takes. */
  name: string;
  dir: string;
  /** `config.json.name`; may differ from the folder name. */
  displayName: string;
  createdAt: string;
  /** True when this row is the site the SERVER PROCESS is bound to right now — never a pending
   *  choice. A newly-activated site stays `false` here until the operator restarts. */
  active: boolean;
  running?: { pid: number; port: number; app: string; scheme: "http" | "https" };
}

/** What the running server is actually serving — mirrors `SiteBinding` in the host's site registry, plus
 *  the route's own `listed`. Kept separate from the list because they can disagree, which is the
 *  whole reason this field exists. */
export interface AdminSiteBinding {
  dir: string;
  name: string;
  /** The host's site-directory override is set, which OUTRANKS the site selection Activate writes — so an activate
   *  would be ignored on the next boot. The screen must say so rather than offer a dead button. */
  dirOverridden: boolean;
  /** Whether `dir` appears in `sites[]` at all. `false` for a site created before the
   *  `.site-meta.json` marker existed (this repo's own dev site folder), which is how the list can
   *  come back EMPTY on a server that is plainly serving something. */
  listed: boolean;
}

/** Mirrors the `GET .../system/sites` response in
 *  the host's sites route. */
export interface AdminLocalSiteState {
  name: string; status: "starting" | "running" | "stopped" | "crashed";
  pid: number | null; port: number | null; daemonPort: number | null; adminUrl: string | null;
  app?: string; external?: boolean;
}
export interface AdminTrashedSite { id: string; name: string; displayName: string }
export type AdminLocalSiteAction = "start" | "stop" | "stop-serving" | "trash" | "restore" | "delete" | "switch";

export interface AdminSitesSnapshot {
  sitesHome?: string;
  localManagementEnabled?: boolean;
  canSwitchNow?: boolean;
  /** Stopping the serving site hands its address to `target`, the most recently started site still
   *  running; `null` means nothing can take over. `available` is false on a host that cannot restart. */
  stopServing?: { available: boolean; target: string | null; chatRunning: boolean };
  localSites?: AdminLocalSiteState[];
  trash?: AdminTrashedSite[];
  /** The deployment capability flag (a host environment switch) — Create/Activate 403 when off. */
  switchingEnabled: boolean;
  sites: AdminSiteListEntry[];
  /** Card preview version tokens (`{ [site name]: capture mtime }`), only for sites with a capture.
   *  Absent from an older server; see the host's preview-URL helper. */
  previewVersions?: Record<string, number>;
  currentSite: AdminSiteBinding;
  /** The site name a previous Activate persisted to `.env`, pending a restart — `null` when none. */
  persistedSiteName: string | null;
  /** The admin password a new site gets when the create form's password is left blank. Sent only
   *  when switching is enabled; absent from an older server. Never written in this bundle. */
  starterAdminPassword?: string;
}

/** The `201` body of `POST .../system/sites`. */
export interface AdminCreatedSite {
  name: string;
  dir: string;
  siteId: string;
}

/** What happened to the create request's `agentPluginTokens`: `saved` = sealed into the new site,
 *  connected on its first start; `failed` = the site exists but the tokens were not kept. */
export interface AdminCreatedSiteAgentPluginTokens {
  status: "none" | "saved" | "failed";
  pluginIds: string[];
}

/** One installed Agent Plugin the create form can connect with a pasted access token
 *  (`GET .../system/sites/token-sign-in-plugins`). */
export interface AdminTokenSignInPlugin {
  pluginId: string;
  displayName: string;
  /** The plugin's own page for creating a token. */
  helpUrl: string;
}

/** The `200` body of `POST .../system/sites/:name/activate`. Nothing was killed, signalled, or
 *  re-exec'd — `restartInstructions` is the server's own prose for what the human must now do, and
 *  the screen renders it verbatim rather than hardcoding a second copy. */
export interface AdminSiteActivation {
  ok: boolean;
  /** Warm switch destination; navigate to this site's own origin. */
  url?: string;
  restarting?: boolean;
  activeSiteName: string;
  restartRequired: boolean;
  restartInstructions: string;
}

/**
 * What the Sites screen hooks need from the outside world, as an interface rather than a direct
 * API import. One port for all three routes rather than one per operation: they read and write the
 * same `sites/` resource, and a test double for one is a double for the resource.
 *
 * `siteRowState`/`activationOutlook`/`siteNameErrorKey` (`rules.ts`) are deliberately NOT here —
 * they are pure rules with no I/O, and per the pattern a hook imports rules directly rather than
 * having them injected.
 */
export interface SitesPort {
  openSite?(required: { url: string }, optional?: Record<string, never>): void;
  manageLocalSite?(input: { name: string; action: AdminLocalSiteAction; confirmed?: boolean; checked?: boolean }, optional?: Record<string, never>): Promise<unknown>;
  listSites(): Promise<AdminSitesSnapshot>;
  createSite(input: { name: string; adminPassword?: string; agentPluginTokens?: Record<string, string> }, optional?: Record<string, never>): Promise<{ site: AdminCreatedSite; agentPluginTokens?: AdminCreatedSiteAgentPluginTokens }>;
  listTokenSignInPlugins(): Promise<{ plugins: AdminTokenSignInPlugin[] }>;
  activateSite(required: { name: string }, optional?: Record<string, never>): Promise<AdminSiteActivation>;
}
