/** Kinds describe the host's routes; only redirect/not-found/well-known affect writing. */
export type ManifestRouteKind = string;
export interface ManifestRoute { path: string; kind: ManifestRouteKind; label: string; redirectTarget?: string; redirectStatusCode?: number }
export interface ManifestActiveTheme { id: string; dir: string; apiVersion?: number }
export interface ManifestSkip { reason: string; detail: string }
export interface RouteManifest { routes: ManifestRoute[]; skipped: ManifestSkip[]; activeTheme?: ManifestActiveTheme }
export interface RouteManifestPort { build(required: Record<string, never>): Promise<RouteManifest> }
export interface AppSession { baseUrl: string; close(required: Record<string, never>): Promise<void> }
export interface AppFactoryPort { open(required: Record<string, never>): Promise<AppSession> }
export interface ArtifactWriterPort {
  prepare(required: { outputDir: string }, optional?: { clean?: boolean }): Promise<void>;
  /** The runner validates outputFile; an adapter must also protect its storage root/symlink boundary. */
  write(required: { outputDir: string; outputFile: string; data: string | Buffer }): Promise<void>;
}
export interface AssetSourcePort { listThemeFiles(required: { theme: ManifestActiveTheme }): Promise<readonly string[]> }
export interface ThemeLayoutPort { resolve(required: { theme: ManifestActiveTheme }): { pagesDir: string; assetUrlPrefix: string } }
export interface ExportedRoute { path: string; kind: ManifestRouteKind; outputFile: string; data: string; contentType?: string | null }
export interface FailedRoute { path: string; kind: ManifestRouteKind; reason: string }
export interface ExportedAsset { url: string; outputFile: string; data: Buffer; contentType?: string | null }
export interface FailedAsset { url: string; reason: string }
export interface ExportReport {
  outputDir: string;
  routes: { succeeded: ExportedRoute[]; failed: FailedRoute[] };
  assets: { succeeded: ExportedAsset[]; failed: FailedAsset[] };
  skippedManifestEntries: ManifestSkip[];
  unreferencedThemeFiles: string[];
  basePath?: string;
  basePathRewriteWarning?: string;
}
/** The host selects the transport; the runner supplies redirect and timeout policy. */
export type ExportFetchPort = (required: { url: string }, optional?: { init?: RequestInit }) => Promise<Response>;
export interface ExportSiteArgs {
  outputDir: string;
  manifest: RouteManifestPort;
  app: AppFactoryPort;
  writer: ArtifactWriterPort;
  fetch: ExportFetchPort;
  assetSource: AssetSourcePort;
  themeLayout: ThemeLayoutPort;
  assetUrlPrefixes: readonly string[];
  requestHeaders: Readonly<Record<string, string>>;
  security: { transformHtml(required: { html: string }): string };
  errorPage: { outputFile: string; acceptStatus(required: { status: number }): boolean };
  /** Caller-safe error description; used for failed network, body or artifact writes. */
  describeError(required: { error: unknown }): string;
}
export interface ExportSiteOptions { clean?: boolean; basePath?: string; fetchTimeoutMs?: number }
export class ExportOutputNotEmptyError extends Error {}
export class ExportPathError extends Error {}
