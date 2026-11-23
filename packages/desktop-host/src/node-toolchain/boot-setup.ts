/**
 * Launch-time mechanics a desktop host runs once per boot: preparing the bundled Node toolchain's
 * child-process env without ever failing the launch, and the two cancellation lanes background site
 * discovery runs in. The host chooses the boot mode, owns every path and env-variable name, and turns
 * the reported setup events into its own warning copy.
 */

/** Why a launch runs without the bundled toolchain; the host words the warning. */
export type NodeToolchainSetupEvent = { kind: 'transient-launch' } | { kind: 'write-failed'; error: unknown };

export interface PrepareNodeToolchainEnvBestEffortInput {
  userDataDir: string;
  electronPath: string;
  npmRoot: string;
  /** The host's bound writer; `null` from a transient (disk-image) launch. May throw. */
  writeNodeToolchain: (input: { userDataDir: string; electronPath: string; npmRoot: string }) => { toolchainDir: string } | null;
  /** The host's bound env builder; it carries the host's own env-variable names. */
  buildNodeToolchainEnv: (input: { toolchainDir: string; npmRoot: string }) => Record<string, string>;
  report: (event: NodeToolchainSetupEvent) => void;
}

/**
 * The bundled toolchain's env contract, or `undefined` when this launch runs without it. Run once,
 * after the user-data directory is set (the shims live under it) and before any child is spawned.
 *
 * Best-effort like every other user-data write at launch: a failure here (a read-only volume, a full
 * disk) must degrade to the old identity behaviour — no bundled toolchain — never crash the app over
 * a feature that is itself an upgrade.
 * @complexity O(1) beyond the writer's own I/O.
 */
export function prepareNodeToolchainEnvBestEffort(
  { userDataDir, electronPath, npmRoot, writeNodeToolchain, buildNodeToolchainEnv, report }: PrepareNodeToolchainEnvBestEffortInput,
  _optional = {},
): Record<string, string> | undefined {
  try {
    const toolchain = writeNodeToolchain({ userDataDir, electronPath, npmRoot });
    if (toolchain) return buildNodeToolchainEnv({ toolchainDir: toolchain.toolchainDir, npmRoot });
    report({ kind: 'transient-launch' });
  } catch (error) {
    report({ kind: 'write-failed', error });
  }
  return undefined;
}

export interface SiteDiscoveryLanes<T> {
  /** A scan with `scanRoots` is a picker validation; without, a rescan. Each supersedes only its own lane. */
  discoverSites(required: { scanRoots?: string[] }, optional?: Record<string, never>): Promise<T>;
  /** Before quit: stop whatever scan of either lane is still running. */
  abortAll(required?: Record<string, never>, optional?: Record<string, never>): void;
}

/**
 * The `discoverSites` dependency with its two independent cancellation lanes, plus the before-quit
 * abort of both. A new scan supersedes the previous scan of the SAME lane only.
 * @param required.discover the host's discoverer, bound to this launch's paths.
 * @complexity O(1) per call beyond the scan.
 */
export function createSiteDiscoveryLanes<T>({ discover }: {
  discover: (required: { scanRoots: string[] | undefined; signal: AbortSignal }) => Promise<T>;
}, _optional = {}): SiteDiscoveryLanes<T> {
  let siteDiscoveryAbort: AbortController | undefined;
  let siteValidationAbort: AbortController | undefined;
  return {
    // `async`: a synchronous throw from `discover` still rejects, so a failed background discovery
    // never throws into the boot sequence that started it without awaiting.
    async discoverSites({ scanRoots }, _options = {}) {
      // Picker validation must not cancel a live rescan, or be cancelled by one.
      if (scanRoots) siteValidationAbort?.abort();
      else siteDiscoveryAbort?.abort();
      const current = new AbortController();
      if (scanRoots) siteValidationAbort = current;
      else siteDiscoveryAbort = current;
      return discover({ scanRoots, signal: current.signal });
    },
    abortAll(_required = {}, _options = {}) {
      siteDiscoveryAbort?.abort();
      siteValidationAbort?.abort();
    },
  };
}
