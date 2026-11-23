/**
 * @file Filesystem layout for installed standalone Agent Skills (the agentskills.io `SKILL.md`
 * format). Sibling of, and deliberately independent from, `src/features/agent-plugins/layout.ts` —
 * see this file's own header below for what carries over and what does not.
 *
 * ---------------------------------------------------------------------------
 * Why this is a FLAT layout, not content-addressed (owner decision, verbatim: "they are different
 * things. there should be a skills/ and a separate agent-plugins/ directory.")
 * ---------------------------------------------------------------------------
 * Standalone skills live in flat named folders. The install service validates uploads and GitHub
 * content before publishing them atomically; installation metadata records provenance and enabled
 * state. Agent Plugins retain their separate content-addressed packaging and runtime.
 *
 * ---------------------------------------------------------------------------
 * Env override and `sites/<name>/` convention (same shape as every other host `*_DIR` override)
 * ---------------------------------------------------------------------------
 * The host's skills-dir override is required to be ABSOLUTE, for the identical reason its agent-plugins-dir override is
 * (`agent-plugins/layout.ts`'s own header): a relative override resolved against an unpredictable
 * `cwd` is a correctness footgun, not a convenience. Defaults to `<site>/skills`, the same
 * `ws/<workspaceId>/` shape `<site>/uploads/` and `<site>/agent-plugins/` already use
 * (`sites/README.md`), where `<site>` is {@link resolveSiteRoot}'s answer — NOT `<cwd>/infra/skills`
 * as it was until 2026-08-27. Installed skills are site data: they must move with the site and
 * survive an upgrade, which a repo-relative `infra/` could not promise.
 *
 * The private id-segment guard now belongs to Jini `skills/install/layout.ts`. This adapter
 * supplies the site root and state-file name; Agent Skills and Agent Plugins retain separate
 * directories and host bindings.
 *
 * Architectural role:
 * Pure path computation. No I/O — `tool-registrations.ts` reads the directory tree this resolves.
 */
import path from "node:path";
import { createSkillLayout, type ArchiveReaderPort, type SkillFilesystemPort, type YamlReaderPort } from "../install/index.js";
import type { InstalledSkillToolPorts } from "../tools/index.js";

/**
 * The host's bindings for site skills, bound once where the host resolves its layout and carried on
 * the returned {@link SkillLayout}, so every entry point that already receives the booted layout
 * (install service, tool registrations, install tool, admin routes) reaches the same values.
 */
export interface SkillSiteHost {
  /** Environment variable that overrides the skills root; must hold an absolute path. */
  readonly overrideEnvVar: string;
  /** Persisted install-state file name inside each skill folder; keep it stable across releases. */
  readonly stateFileName: string;
  /** The host process environment, read when a caller passes no `env`. */
  readonly processEnv: () => NodeJS.ProcessEnv;
  /** The host's site root when no booted `siteDir` is supplied. */
  readonly resolveSiteRoot: (required: { cwd: string; env: NodeJS.ProcessEnv }) => string;
  /** Filesystem port the installer and the install-state reader use. */
  readonly filesystem: SkillFilesystemPort;
  /** Zip decoder for uploaded skill archives. */
  readonly archiveReader: ArchiveReaderPort;
  /** YAML decoder for SKILL.md frontmatter validation. */
  readonly yamlReader: YamlReaderPort;
  /** One frontmatter field of a SKILL.md, for request-time skill discovery. */
  readonly readFrontmatterField: InstalledSkillToolPorts["readFrontmatterField"];
  /** The contained supporting-file reader for one skill folder. */
  readonly createFileReader: InstalledSkillToolPorts["createFileReader"];
  /** Per-root installer queues; the host owns one map so every entry point on a root shares one queue. */
  readonly installers: Map<string, import("../install/index.js").SkillInstaller>;
  /** Refuses a principal without `permission`; the install tool calls it before any fetch. */
  readonly requireToolPermission: (
    required: { authorize: import("@jini-ai/core/contracts/events").AuthorizeFn; workspaceId: string; principalId: string; permission: string },
    optional: { entityType: string },
  ) => Promise<void>;
}

/** One workspace's flat directory of installed skill folders: `<root>/ws/<workspaceId>/<skill-dir>/
 *  SKILL.md`, one subdirectory per skill. Not content-addressed — see this module's header. */
export interface SkillWorkspaceLayout {
  /** `<instance root>/ws/<workspaceId>` */
  readonly root: string;
}

export interface SkillLayout {
  /** `<site>/skills` (or the host's override directory) — the whole tree this feature owns. */
  readonly root: string;
  /** The host bindings this layout was resolved with. */
  readonly host: SkillSiteHost;
  /**
   * Resolves the workspace-scoped skills directory for one workspace.
   *
   * @throws {Error} If `workspaceId` does not match the safe path-segment grammar (see
   * Jini skills/install/layout.ts's SAFE_ID_SEGMENT_PATTERN).
   */
  forWorkspace(required: { workspaceId: string }, optional?: Record<string, never>): SkillWorkspaceLayout;
}

export interface ResolveSkillLayoutOptional {
  /** Defaults to `process.cwd()` — injectable so this function is testable without `process.chdir()`. */
  readonly cwd?: string;
  /** Booted site directory; defaults are anchored here when supplied. */
  readonly siteDir?: string;
  /** Defaults to the host's `processEnv()`. */
  readonly env?: NodeJS.ProcessEnv;
  /** The host's bindings, carried on the returned layout. */
  readonly host: SkillSiteHost;
}

/**
 * Resolves the Agent Skills filesystem layout for this host instance.
 *
 * @throws {Error} If the host's override variable is set to a relative path.
 * @complexity O(1).
 */
export function resolveSkillLayout(optional: ResolveSkillLayoutOptional): SkillLayout {
  const cwd = optional.cwd ?? process.cwd();
  const host = optional.host;
  const env = optional.env ?? host.processEnv();
  const override = env[host.overrideEnvVar];

  if (override !== undefined && !path.isAbsolute(override)) {
    throw new Error(`${host.overrideEnvVar} must be an absolute path, got '${override}'`);
  }

  const root = path.resolve(override ?? path.join(optional.siteDir ?? host.resolveSiteRoot({ cwd, env }), "skills"));

  const layout = createSkillLayout({ root, stagingRoot: path.join(root, ".staging"), workspaceDirectory: "ws", stateFileName: host.stateFileName });
  return { root, host, forWorkspace({ workspaceId }, _optional = {}) {
    try { return { root: layout.resolve({ workspaceId }).workspaceRoot }; }
    catch {
      // Quotes the RAW input, not the normalized one, so the message names what the caller passed.
      throw new Error(`forWorkspace: '${workspaceId}' is not a valid workspace id`);
    }
  } };
}
