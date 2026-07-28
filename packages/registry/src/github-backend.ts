/**
 * @module github-backend
 *
 * A `RegistryBackend` whose manifest lives in a GitHub repository. Reads the
 * whole manifest once (via an injected {@link GithubRegistryClient}) and
 * serves `list`/`search`/`resolve`/`doctor` from that in-memory snapshot
 * exactly like `StaticRegistryBackend`; `publish`/`yank` open a pull request
 * against the same repo (or return a dry-run payload when the client has no
 * mutation capability configured).
 */
import type {
  RegistryManifest,
  RegistryPublishOutcome,
  RegistryPublishRequest,
  RegistryTrust,
  RegistryYankOutcome,
} from '@jini-ai/protocol';
import { assertValidPublishRequest, StaticRegistryBackend } from './static-backend.js';
import type { RegistryTrustRoot } from './trust.js';

/** `vendor/name` — deliberately the same shape `RegistryEntrySchema.name` requires. */
const SAFE_ENTRY_NAME = /^([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/;
/** A single safe path/branch segment: alnum-bounded, no separators, no traversal. */
const SAFE_VERSION = /^[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?$/;
// eslint-disable-next-line no-control-regex -- deliberately matching C0/DEL control bytes.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Split and validate a registry entry name into safe `vendor`/`name` path
 * segments. `publish`/`yank` are public methods that take plain strings from
 * an untyped JS caller — TypeScript's compile-time `RegistryEntry`/`string`
 * types give no runtime guarantee, so this boundary must reject path
 * traversal (`..`, `/`) and anything else that isn't the expected shape
 * before the value is used to build a file path or PR branch name.
 */
function assertSafeEntryName(name: string): [vendor: string, entryName: string] {
  const match = SAFE_ENTRY_NAME.exec(name);
  if (!match) {
    throw new Error(
      `Invalid registry entry name ${JSON.stringify(name)}: expected "vendor/name" (lowercase letters, digits, ".", "_", "-").`,
    );
  }
  return [match[1]!, match[2]!];
}

/** Validate a version string used to build a file path/branch name segment. */
function assertSafeVersion(version: string): string {
  if (!SAFE_VERSION.test(version)) {
    throw new Error(
      `Invalid version ${JSON.stringify(version)}: expected a safe identifier (letters, digits, ".", "_", "+", "-").`,
    );
  }
  return version;
}

/** Reject control characters (including NUL) in free-text fields embedded in a PR title/body. */
function assertNoControlChars(value: string, label: string): string {
  if (CONTROL_CHARS.test(value)) {
    throw new Error(`Invalid ${label}: control characters are not allowed.`);
  }
  return value;
}

/** Read/write access to a GitHub-hosted registry manifest, injected by the host. */
export interface GithubRegistryClient {
  readManifest(owner: string, repo: string, ref: string, path: string): Promise<RegistryManifest>;
  createPublishPullRequest?(request: GithubPublishMutation): Promise<{ url: string }>;
}

export interface GithubPublishMutation {
  owner: string;
  repo: string;
  baseRef: string;
  branchName: string;
  title: string;
  body: string;
  files: Array<{ path: string; content: string }>;
}

export interface GithubRegistryBackendOptions {
  id: string;
  owner: string;
  repo: string;
  ref?: string;
  manifestPath?: string;
  /**
   * Trust level to publish this backend under. There is no signature/allowlist
   * proof tying a GitHub `owner/repo/ref` to any trust class, so this MUST be
   * an explicit decision by the host wiring the backend up — it is never
   * inferred from the fact that the source happens to be GitHub. Defaults to
   * the least-privileged `'restricted'` when omitted.
   */
  trust?: RegistryTrust;
  client: GithubRegistryClient;
  /** Optional `github-oidc` signature trust root — see `StaticRegistryBackendOptions.trustRoot`'s doc comment for what configuring (or omitting) this does. */
  trustRoot?: RegistryTrustRoot | undefined;
}

const DEFAULT_MANIFEST_PATH = 'registry/index.json';

export class GithubRegistryBackend extends StaticRegistryBackend {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  readonly manifestPath: string;
  readonly client: GithubRegistryClient;

  // `ref`/`manifestPath` are required (not `?:`) here — the only call site,
  // `create()`, always resolves them to concrete strings before constructing,
  // so a `??` default in this constructor would be unreachable dead code.
  private constructor(options: Omit<GithubRegistryBackendOptions, 'ref' | 'manifestPath'> & {
    ref: string;
    manifestPath: string;
    manifest: RegistryManifest;
  }) {
    super({ id: options.id, kind: 'github', trust: options.trust ?? 'restricted', manifest: options.manifest, trustRoot: options.trustRoot });
    this.owner = options.owner;
    this.repo = options.repo;
    this.ref = options.ref;
    this.manifestPath = options.manifestPath;
    this.client = options.client;
  }

  /**
   * Read the manifest from the configured GitHub path and construct the backend.
   *
   * @param options - Repo coordinates, optional ref/path, and the client to read/write through.
   * @returns The constructed backend, already holding its first manifest snapshot.
   */
  static async create(options: GithubRegistryBackendOptions): Promise<GithubRegistryBackend> {
    const ref = options.ref ?? 'main';
    const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
    const manifest = await options.client.readManifest(options.owner, options.repo, ref, manifestPath);
    return new GithubRegistryBackend({ ...options, ref, manifestPath, manifest });
  }

  async publish(request: RegistryPublishRequest): Promise<RegistryPublishOutcome> {
    // `publish` is a public method on a plain-string/JS-object boundary — an
    // untyped caller's `name`/`version` are used to build a file path and PR
    // branch name below, so both must be validated before that happens.
    const [vendor, name] = assertSafeEntryName(request.entry.name);
    const version = assertSafeVersion(request.entry.version);
    // Beyond the path-safety checks above, validate the *whole* request
    // against the wire schema before any of its fields get written into the
    // published manifest content below (see CR-009/`assertValidPublishRequest`).
    const parsed = assertValidPublishRequest(request);
    const root = `entries/${vendor}/${name}`;
    const files = [
      { path: `${root}/entry.json`, content: `${JSON.stringify(parsed.entry, null, 2)}\n` },
      {
        path: `${root}/versions/${version}.json`,
        content: `${JSON.stringify({ ...parsed.entry, publishedAt: new Date().toISOString(), tag: parsed.tag ?? 'latest' }, null, 2)}\n`,
      },
    ];

    if (parsed.dryRun || !this.client.createPublishPullRequest) {
      return {
        ok: true,
        dryRun: true,
        changedFiles: files.map((file) => file.path),
        warnings: this.client.createPublishPullRequest ? [] : ['github mutation client unavailable; emitted dry-run payload only'],
      };
    }

    const mutation: GithubPublishMutation = {
      owner: this.owner,
      repo: this.repo,
      baseRef: this.ref,
      branchName: `publish/${vendor}-${name}-${version}`,
      title: `Add ${parsed.entry.name}@${version}`,
      body: renderPublishBody(parsed),
      files,
    };
    const pr = await this.client.createPublishPullRequest(mutation);
    return { ok: true, dryRun: false, pullRequestUrl: pr.url, changedFiles: files.map((file) => file.path), warnings: [] };
  }

  async yank(name: string, version: string, reason: string): Promise<RegistryYankOutcome> {
    const [vendor, entryName] = assertSafeEntryName(name);
    const safeVersion = assertSafeVersion(version);
    assertNoControlChars(reason, 'yank reason');
    const path = `entries/${vendor}/${entryName}/versions/${safeVersion}.json`;
    if (!this.client.createPublishPullRequest) {
      // Same honest-outcome treatment as `publish`: no mutation capability
      // means this is implicitly a dry run, not a real yank — say so.
      return {
        ok: true,
        dryRun: true,
        name,
        version,
        reason,
        warnings: ['github mutation client unavailable; emitted dry-run yank only'],
      };
    }
    const mutation: GithubPublishMutation = {
      owner: this.owner,
      repo: this.repo,
      baseRef: this.ref,
      branchName: `yank/${vendor}-${entryName}-${safeVersion}`,
      title: `Yank ${name}@${version}`,
      body: `Yank ${name}@${version}\n\nReason: ${reason}\n`,
      files: [
        {
          path,
          content: `${JSON.stringify({ name, version, yanked: true, yankedAt: new Date().toISOString(), yankReason: reason }, null, 2)}\n`,
        },
      ],
    };
    const pr = await this.client.createPublishPullRequest(mutation);
    return { ok: true, dryRun: false, name, version, reason, pullRequestUrl: pr.url, warnings: [] };
  }
}

function renderPublishBody(request: RegistryPublishRequest): string {
  return [
    `Publish ${request.entry.name}@${request.entry.version}`,
    '',
    request.entry.description ?? '',
    '',
    '## Registry metadata',
    '',
    `- source: ${request.entry.source}`,
    `- integrity: ${request.entry.integrity ?? request.entry.dist?.integrity ?? '(pending)'}`,
    `- manifestDigest: ${request.entry.manifestDigest ?? request.entry.dist?.manifestDigest ?? '(pending)'}`,
    `- capabilities: ${(request.entry.capabilitiesSummary ?? []).join(', ') || '(none declared)'}`,
    request.changelog ? `\n## Changelog\n\n${request.changelog}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
