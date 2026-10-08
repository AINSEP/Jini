import type { PluginManifest, PluginValidationError } from "./manifest.js";

/** A built-in plugin's in-code manifest-equivalent (ADR Decision item 4) — no tarball, no
 * integrity file (compiled-in code is definitionally not tampered), but still validated through
 * the same `validateManifest()` path as a site-installed plugin. */
export interface BuiltInPluginSource {
  readonly manifest: PluginManifest;
}

/** In-memory, rebuilt each discovery pass — NOT persisted (state.spec.md §2). Feeds `PLUGINS_LIST`
 * once activation state is projected onto it by the caller (the HTTP route layer, C-016/C-017 —
 * discovery itself does not know about `plugin_activations`). */
export interface PluginDiscoveryRecord {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source: "built-in" | "site";
  /** (1.1.2, REQ-10/REQ-18) The plugin's trust tier, projected verbatim from the already-required
   * `PluginManifest.tier` (REQ-01/ADR-024 §1) — mirrors how `source` already passes through
   * unchanged. Optional on this stub type only so pre-existing fixtures in unrelated test files
   * (`activation.integration.test.ts`, `loader.integration.test.ts`) that construct
   * `PluginDiscoveryRecord` literals for concerns unrelated to REQ-10/`PLUGINS_LIST` are not forced
   * to retrofit it; the real `discoverPlugins()` implementation must always populate it (a
   * discovered plugin's manifest always has a validated `tier` by the time a record exists),
   * enforced behaviorally by the dedicated REQ-10 pass-through tests in `plugins-dto.unit.test.ts`
   * / `plugins-http.integration.test.ts`, not by widening this field to non-optional everywhere. */
  readonly tier?: "tier-1" | "tier-2" | "tier-3";
  readonly status: "valid" | "invalid" | "incompatible";
  readonly errors: readonly PluginValidationError[];
  /**
   * (Milestone 1b, 2026-08-20) The already-parsed, already-`validateManifest()`-checked manifest
   * this record was built from — present if and only if `status === "valid"` (`undefined`
   * otherwise: an invalid/incompatible candidate's raw JSON may not conform to `PluginManifest`'s
   * shape at all, so this field never claims a validated type for a record that failed validation).
   *
   * Exists so a composition root's enable path (`server/plugin-runtime.ts`'s `onPluginEnabled()`)
   * can hand `loadPlugin()` the SAME manifest object this discovery pass already parsed, instead of
   * re-reading `tovu.plugin.json` a second time. This matters beyond avoiding duplicate I/O: every
   * real caller of `onPluginEnabled` (`activation.ts`'s `setPluginEnabled`, BR-05 step 1) already
   * calls `discoverPlugins()` fresh, in the SAME request, immediately before invoking it (see
   * `routes/admin/plugins/set-enabled.ts`) — so reusing that record's manifest is not a staleness
   * risk, it is the one-and-only read for this attempt. A second, independent load-time re-read
   * would instead open a narrow TOCTOU window: an attacker who can write to `installDir` between
   * the discovery read and a second load-time read could swap in a self-consistent tampered
   * manifest+entry pair that the discovery pass never actually validated. Reusing this field closes
   * that window by construction — there is only one read to race against, not two.
   *
   * Built-in records also carry it (trivially, from `BuiltInPluginSource.manifest`) for type
   * uniformity, but `onPluginEnabled`'s built-in branch does not need it — it already has the
   * composition root's own static `PluginRuntimeSource.manifest`, unchanged from before this slice.
   */
  readonly manifest?: PluginManifest | undefined;
}

