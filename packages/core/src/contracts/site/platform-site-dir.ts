/**
 * @file Site-directory registry shapes a host's site switcher, site creation and site import share.
 * Types only: the host keeps the registry, the filesystem effects and its own environment-variable
 * vocabulary; these shapes carry no host names.
 */

export interface InitSiteResult {
  siteId: string;
  dir: string;
}

export interface SiteCreationAllocation extends InitSiteResult { name: string; dbPath: string }

export interface CreateSiteResult extends InitSiteResult {
  name: string;
}

/** What THIS process is actually bound to right now — see the host's `describeSiteBinding`. */
export interface SiteBinding {
  /** Absolute path this process resolved at boot (`resolveSiteRoot()`), re-derived fresh. */
  dir: string;
  /** `dir`'s folder name — the host site-name variable's vocabulary `persistActiveSite` writes in. */
  name: string;
  /**
   * True when the host's site-dir override variable is set in this process's environment.
   *
   * Load-bearing for the admin Sites screen, not a diagnostic nicety: `resolveSiteRoot`'s
   * precedence puts the site-dir override ABOVE the site-name line `persistActiveSite` writes, so when
   * this is true an activate is inert — the next boot resolves the override and ignores the
   * persisted choice entirely. A UI that offered Activate without saying so would promise a switch
   * that cannot happen.
   */
  dirOverridden: boolean;
  /**
   * False when `dir` was resolved from an explicit, arbitrary install-dir argument (a host `serve
   * <dir>` / `bootSiteDir`) rather than from THIS function's own `{cwd, env}`-relative
   * `<cwd>/sites/<name>` convention.
   *
   * `listSites`/`createSite`/`persistActiveSite`/`sites_duplicate_site` all resolve their OWN
   * `sites/` root from a `cwd` — `process.cwd()` by default, which is a DIFFERENT computation from
   * whatever `dir` this binding names. The Sites routes and tools therefore never let it default:
   * they pass the host's `switcherBaseForBinding`'s base, which exists only when this is `true`. `false`
   * tells those write paths to refuse rather than silently write under an unrelated `<cwd>/sites`.
   *
   * `describeSiteBinding` used to hardcode this `true`, on the stated reasoning that its own
   * `{cwd, env}` resolution always agrees with the switcher's. That reasoning did not cover
   * the site-dir override, which `resolveSiteRoot` honors outright and which can name any path on the
   * disk — so an override pointing outside `<cwd>/sites` produced a binding that CLAIMED to be
   * switchable while the switcher's own root was somewhere else entirely. It is computed now (see
   * the host's `describeSiteBinding`), and additionally forced off by
   * the host's `SITE_BINDING_NOT_SWITCHABLE_ENV` for the one case no path comparison can detect: a
   * host `serve <dir>` boot whose `<dir>` happens to sit under `<cwd>/sites` but was still pinned
   * by an explicit argument rather than chosen through the switcher.
   */
  switcherCompatible: boolean;
  /** Repo base is independent of the selected shared home; .env remains repo-owned. */
  switcherBase?: string;
}
