/**
 * @file The admin Sites wire DTOs: the listing snapshot (`GET .../system/sites`), the machine-local
 * sites config, and the create/activate/token-plugin bodies. One owner, shared by the host's sites
 * routes and the admin client that reads them back, so neither side keeps a second copy. Types only.
 */

/** One row of the admin Sites screen — mirrors the host's site-registry list entry. Only
 *  directories carrying a valid `.site-meta.json` commit marker appear; see
 *  {@link AdminSiteBinding.listed} for why that matters. */
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

/** What the running server is actually serving — mirrors the host's site-registry binding, plus
 *  the route's own `listed`. Kept separate from the list because they can disagree, which is the
 *  whole reason this field exists. */
export interface AdminSiteBinding {
  dir: string;
  name: string;
  /** The host's site-directory environment override is set, which OUTRANKS the site-name line
   *  Activate writes — so an activate would be ignored on the next boot. The screen must say so
   *  rather than offer a dead button. */
  dirOverridden: boolean;
  /** Whether `dir` appears in `sites[]` at all. `false` for a site created before the
   *  `.site-meta.json` marker existed (the host repo's own dev site folder), which is how the list
   *  can come back EMPTY on a server that is plainly serving something. */
  listed: boolean;
}

/** Mirrors the host's `GET .../system/sites` local-site state. */
export interface AdminLocalSiteState {
  name: string; status: "starting" | "running" | "stopped" | "crashed";
  pid: number | null; port: number | null; daemonPort: number | null; adminUrl: string | null;
  app?: string; external?: boolean;
}
export interface AdminTrashedSite { id: string; name: string; displayName: string }
export type AdminLocalSiteAction = "start" | "stop" | "stop-serving" | "trash" | "restore" | "delete" | "switch";

/** Machine-local config, shared with desktop. Runtime env overrides are displayed explicitly. */
export interface SitesUserConfig {
  sitesHome: string; siteRoots: string[]; databases: "inSite" | "appData";
  configPath: string; appData: string;
  overrides: { sitesHome: boolean; siteRoots: boolean };
  warning: { provider: string; message: string; localHome: string } | null;
}
export type SitesUserConfigPatch = Partial<Pick<SitesUserConfig, "sitesHome" | "siteRoots" | "databases">>;
export interface AdminSitesSnapshot {
  sitesHome?: string;
  localManagementEnabled?: boolean;
  canSwitchNow?: boolean;
  /** Stopping the serving site hands its address to `target`, the most recently started site still
   *  running; `null` means nothing can take over. `available` is false on a host that cannot restart. */
  stopServing?: { available: boolean; target: string | null; chatRunning: boolean };
  localSites?: AdminLocalSiteState[];
  trash?: AdminTrashedSite[];
  /** The deployment's site-switcher capability flag — Create/Activate 403 when off. */
  switchingEnabled: boolean;
  sites: AdminSiteListEntry[];
  /** Card preview version tokens (`{ [site name]: capture mtime }`), only for sites with a capture.
   *  Absent from an older server; see the host's site preview address helper. */
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
