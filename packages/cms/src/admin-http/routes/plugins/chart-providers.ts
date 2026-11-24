/**
 * @file Framework-neutral logic of the admin chart-provider routes: the bootstrap metadata reply and
 * the exact admitted-asset lookup. Inputs go in, `{ status, headers, body }` comes out; the host's
 * HTTP adapter owns the guard, the transport, and the failure envelope (a thrown error is the host's
 * to answer). Admin-only chart metadata and immutable bytes; installed/custom browser providers never
 * enter this port.
 */

/** What every reply carries; the host writes it as-is. */
export interface ChartProviderReply<Body> {
  readonly status: number;
  /** Header names exactly as the host must set them. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Body;
}

/** One admitted, digest-pinned asset a browser provider retains. */
export interface ChartProviderAsset {
  readonly digest: string;
  readonly path: string;
  readonly contentType: string;
  readBytes(input: Record<string, never>): Uint8Array;
}

/** The slice of an admitted browser provider the asset lookup reads. */
export interface ChartProviderEntry {
  readonly pluginId: string;
  readonly version: string;
  readonly assets: readonly ChartProviderAsset[];
}

/** Collaborators of {@link chartProviderMetadata}; `Snapshot` is the host's wire snapshot type. */
export interface ChartProviderMetadataDeps<Snapshot> {
  /** Absent on a host with no chart runtime; the reply is then {@link ChartProviderMetadataDeps.coreSnapshot}. */
  chartProviderSnapshot?(input: Record<string, never>): Promise<Snapshot>;
  /** What the admin draws when no snapshot port is composed: the core table, no providers. */
  readonly coreSnapshot: Snapshot;
}

/** Collaborators of {@link chartProviderAsset}. */
export interface ChartProviderAssetDeps {
  /** Absent on a host with no browser-provider runtime; every asset is then a 404. */
  browserProviders?(input: Record<string, never>): { readonly providers: readonly ChartProviderEntry[] };
}

/** The four URL parameters that name one asset exactly. */
export interface ChartAssetParams { pluginId: string; version: string; digest: string; filename: string }

/**
 * `GET …/chart-providers` — the provider snapshot, never cached.
 * @returns A 200 reply `{ data }` with `Cache-Control: no-store`.
 * @throws Whatever the snapshot port throws; the host answers its fixed failure envelope.
 * @complexity O(p) for the admitted providers the port lists.
 * @example await chartProviderMetadata({ deps: { chartProviderSnapshot, coreSnapshot } });
 */
export async function chartProviderMetadata<Snapshot>(
  required: { deps: ChartProviderMetadataDeps<Snapshot> },
  _optional: Record<string, never> = {},
): Promise<ChartProviderReply<{ data: Snapshot }>> {
  const { deps } = required;
  // A host without a chart snapshot has no provider to prefer: the admin draws the core table.
  const data = await deps.chartProviderSnapshot?.({}) ?? deps.coreSnapshot;
  return { status: 200, headers: { "Cache-Control": "no-store" }, body: { data } };
}

/**
 * `GET …/chart-providers/assets/:pluginId/:version/:digest/:asset` — the retained bytes of exactly
 * one admitted asset (plugin, version, digest and file name all match), cacheable forever.
 * @returns A 200 reply carrying the bytes with the asset's content type, `nosniff` and an immutable
 *   private cache header; otherwise a 404 `{ error }` with no asset headers.
 * @complexity O(p + a) over the admitted providers and their assets.
 * @example chartProviderAsset({ deps: { browserProviders }, params: { pluginId, version, digest, filename } });
 */
export function chartProviderAsset(
  required: { deps: ChartProviderAssetDeps; params: ChartAssetParams },
  _optional: Record<string, never> = {},
): ChartProviderReply<Uint8Array | { error: string }> {
  const { deps, params } = required;
  const providers = deps.browserProviders?.({}).providers.filter((provider) => provider.pluginId === params.pluginId && provider.version === params.version) ?? [];
  const asset = providers.flatMap((provider) => provider.assets).find((candidate) => candidate.digest === params.digest && candidate.path.split("/").at(-1) === params.filename);
  if (!asset) return { status: 404, headers: {}, body: { error: "chart asset was not found" } };
  return {
    status: 200,
    headers: { "Content-Type": asset.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
    body: asset.readBytes({}),
  };
}
