/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import path from "node:path";
import type { AgentPluginLayout } from "./layout.js";
import { parseAgentPluginManifest as parseAgentPluginManifestValue } from "./manifest.js";
import { PackagePathViolation } from "./package-paths.js";
import { createPackagePathsModule } from "./package-paths.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import type { InstalledAgentPlugin, InstalledAgentPluginSkill } from "./types.js";
export type { InstalledAgentPlugin, InstalledAgentPluginSkill } from "./types.js";

export type AgentPluginInstallErrorCode =
  | "ARCHIVE_TOO_LARGE"
  | "DIGEST_MISMATCH"
  | "TOO_MANY_ENTRIES"
  | "UNSAFE_ENTRY_PATH"
  | "SYMLINK_ENTRY_REJECTED"
  | "UNSUPPORTED_ENTRY_KIND"
  | "DUPLICATE_ENTRY"
  | "FILE_TOO_LARGE"
  | "DECOMPRESSION_BOMB"
  | "TOTAL_SIZE_EXCEEDED"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "PUBLISH_FAILED";

export class AgentPluginInstallError extends Error {
  readonly code: AgentPluginInstallErrorCode;

  constructor({ code, message }: { readonly code: AgentPluginInstallErrorCode; readonly message: string }, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "AgentPluginInstallError";
    this.code = code;
  }
}

export type AgentPluginArchiveEntry =
  | {
      readonly kind: "file";
      readonly entryPath: string;

      readonly declaredSize?: (number) | undefined;
      readonly executable?: (boolean) | undefined;
      readonly openReadStream: (required: Record<string, never>) => AsyncIterable<Uint8Array>;
    }
  | { readonly kind: "directory"; readonly entryPath: string }
  | { readonly kind: "symlink" | "hardlink" | "device" | "fifo"; readonly entryPath: string; readonly linkTarget?: string | undefined };

export interface AgentPluginArchiveReaderPort {
  entries(required: { readonly archive: Uint8Array }): AsyncIterable<AgentPluginArchiveEntry>;
}

export interface InstallAgentPluginRequired {
  readonly archive: Uint8Array;

  readonly expectedSha256: string;
  readonly archiveReader: AgentPluginArchiveReaderPort;

  readonly layout: AgentPluginLayout;

  readonly workspaceId: string;
}

export type InstallAgentPluginOptional = {};

function buildModule(ports: AgentPluginLifecyclePorts) {
  const chmod = ports.filesystem.chmod.bind(ports.filesystem);
  const mkdir = ports.filesystem.mkdir.bind(ports.filesystem);
  const mkdtemp = ports.filesystem.mkdtemp.bind(ports.filesystem);
  const open = ports.filesystem.open.bind(ports.filesystem);
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const rename = ports.filesystem.rename.bind(ports.filesystem);
  const rm = ports.filesystem.rm.bind(ports.filesystem);
  const stat = ports.filesystem.stat.bind(ports.filesystem);
  const parseAgentPluginManifest = (value: unknown) => parseAgentPluginManifestValue({ value });
  const { assertContainedOnDisk, normalizePackageEntryPath } = createPackagePathsModule(ports);
  const LIMITS = {
    maxArchiveBytes: 32 * 1024 * 1024,
    maxEntries: 4096,
    maxFileBytes: 16 * 1024 * 1024,
    maxTotalExtractedBytes: 64 * 1024 * 1024,
  } as const;

  function maxAgentPluginInstallArchiveBytes(): number {
    return LIMITS.maxArchiveBytes;
  }

  const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

  async function installAgentPlugin(
    required: InstallAgentPluginRequired,
    _optional: InstallAgentPluginOptional = {}
  ): Promise<InstalledAgentPlugin> {
    const { archive, expectedSha256, archiveReader, layout, workspaceId } = required;

    const workspaceLayout = layout.forWorkspace({ workspaceId });

    if (archive.byteLength > LIMITS.maxArchiveBytes) {
      throw new AgentPluginInstallError({ code: "ARCHIVE_TOO_LARGE", message: `archive is ${archive.byteLength} bytes, over the ${LIMITS.maxArchiveBytes}-byte cap` });
    }

    const digest = sha256(archive);
    if (!SHA256_HEX_PATTERN.test(expectedSha256) || digest !== expectedSha256.toLowerCase()) {
      throw new AgentPluginInstallError({ code: "DIGEST_MISMATCH", message: `archive SHA-256 '${digest}' does not match the expected '${expectedSha256}' — refusing to extract unverified bytes` });
    }

    await mkdir(workspaceLayout.packages, { recursive: true, mode: 0o700 });

    const finalRoot = path.join(workspaceLayout.packages, digest);
    const alreadyPublished = await isRealDirectory(finalRoot);
    if (alreadyPublished) {

      return indexInstalledRoot(finalRoot, digest);
    }

    await mkdir(workspaceLayout.staging, { recursive: true, mode: 0o700 });
    const transactionRoot = await mkdtemp(path.join(workspaceLayout.staging, "install-"));
    const extractionRoot = path.join(transactionRoot, "root");
    await mkdir(extractionRoot, { mode: 0o700 });

    try {
      const executablePaths = await extractEntries(archiveReader.entries({ archive }), extractionRoot);
      const indexed = await indexInstalledRoot(extractionRoot, digest);

      await publish(extractionRoot, finalRoot);
      await freezeTree(finalRoot, executablePaths);
      return { ...indexed, packageRoot: finalRoot };
    } finally {

      await rm(transactionRoot, { recursive: true, force: true });
    }
  }

  function symlinkRejectionMessage(entry: AgentPluginArchiveEntry): string {
    const targetSuffix = "linkTarget" in entry && entry.linkTarget ? ` (target '${entry.linkTarget}')` : "";
    return `archive entry '${entry.entryPath}' has kind '${entry.kind}', which Agent Plugin packages are not permitted to contain${targetSuffix}`;
  }

  function normalizeEntryPathOrThrow(entryPath: string): string {
    try {
      return normalizePackageEntryPath(entryPath);
    } catch (error) {
      throw new AgentPluginInstallError({ code: "UNSAFE_ENTRY_PATH", message: `archive entry path is unsafe: '${entryPath}'` }, { cause: error });
    }
  }

  async function resolveContainedDestinationOrThrow(extractionRoot: string, normalized: string): Promise<string> {
    try {
      return await assertContainedOnDisk(extractionRoot, normalized);
    } catch (error) {
      throw new AgentPluginInstallError({ code: "UNSAFE_ENTRY_PATH", message: `archive entry resolves outside the package root: '${normalized}'` }, {
        cause: error instanceof PackagePathViolation ? error : undefined,
      });
    }
  }

  async function extractOneEntry(args: {
    entry: AgentPluginArchiveEntry;
    extractionRoot: string;
    seen: Set<string>;
    executablePaths: Set<string>;
    totalBytesSoFar: number;
  }): Promise<number> {
    const { entry, extractionRoot, seen, executablePaths, totalBytesSoFar } = args;

    if (entry.kind !== "file" && entry.kind !== "directory") {
      throw new AgentPluginInstallError({ code: "SYMLINK_ENTRY_REJECTED", message: symlinkRejectionMessage(entry) });
    }

    const normalized = normalizeEntryPathOrThrow(entry.entryPath);

    if (seen.has(normalized)) {
      throw new AgentPluginInstallError({ code: "DUPLICATE_ENTRY", message: `duplicate archive entry '${normalized}' — refusing a second write over an already-vetted first one` });
    }
    seen.add(normalized);

    const destination = await resolveContainedDestinationOrThrow(extractionRoot, normalized);

    if (entry.kind === "directory") {
      await mkdir(destination, { recursive: true, mode: 0o700 });
      return totalBytesSoFar;
    }

    if ((entry.declaredSize ?? 0) > LIMITS.maxFileBytes) {
      throw new AgentPluginInstallError({ code: "FILE_TOO_LARGE", message: `archive file '${normalized}' declares ${entry.declaredSize} bytes, over the ${LIMITS.maxFileBytes}-byte cap` });
    }

    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const totalBytes = await writeContainedFile({
      destination,
      normalized,
      stream: entry.openReadStream({}),
      totalBytesSoFar,
    });

    if (entry.executable) executablePaths.add(normalized);
    return totalBytes;
  }

  async function extractEntries(
    entries: AsyncIterable<AgentPluginArchiveEntry>,
    extractionRoot: string,
  ): Promise<ReadonlySet<string>> {
    const seen = new Set<string>();
    const executablePaths = new Set<string>();
    let entryCount = 0;
    let totalBytes = 0;

    for await (const entry of entries) {
      entryCount += 1;
      if (entryCount > LIMITS.maxEntries) {
        throw new AgentPluginInstallError({ code: "TOO_MANY_ENTRIES", message: `archive exceeds the ${LIMITS.maxEntries}-entry cap` });
      }

      totalBytes = await extractOneEntry({ entry, extractionRoot, seen, executablePaths, totalBytesSoFar: totalBytes });
    }

    return executablePaths;
  }

  async function writeContainedFile(params: {
    destination: string;
    normalized: string;
    stream: AsyncIterable<Uint8Array>;
    totalBytesSoFar: number;
  }): Promise<number> {
    let flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
    if (ports.process.platform !== "win32") flags |= constants.O_NOFOLLOW;

    const handle = await open(params.destination, flags, 0o600);
    let fileBytes = 0;
    let totalBytes = params.totalBytesSoFar;

    try {
      for await (const chunk of params.stream) {
        fileBytes += chunk.byteLength;
        totalBytes += chunk.byteLength;

        if (fileBytes > LIMITS.maxFileBytes) {
          throw new AgentPluginInstallError({ code: "DECOMPRESSION_BOMB", message: `archive file '${params.normalized}' exceeded the ${LIMITS.maxFileBytes}-byte cap while decompressing — its declared size was a lie` });
        }
        if (totalBytes > LIMITS.maxTotalExtractedBytes) {
          throw new AgentPluginInstallError({ code: "TOTAL_SIZE_EXCEEDED", message: `archive exceeds the ${LIMITS.maxTotalExtractedBytes}-byte total extracted-size cap` });
        }

        await handle.write(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
      }
    } finally {
      await handle.close();
    }

    return totalBytes;
  }

  async function indexInstalledRoot(packageRoot: string, archiveDigest: string): Promise<InstalledAgentPlugin> {
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(path.join(packageRoot, "plugin.json"), "utf8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        throw new AgentPluginInstallError({ code: "MANIFEST_MISSING", message: "the archive does not contain a plugin.json at its root" });
      }
      throw error;
    }

    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestRaw);
    } catch (error) {
      throw new AgentPluginInstallError({ code: "MANIFEST_INVALID", message: "plugin.json is not valid JSON" }, { cause: error });
    }

    const parsed = parseAgentPluginManifest(manifestValue);
    if (!parsed.ok) {
      throw new AgentPluginInstallError({ code: "MANIFEST_INVALID", message: `plugin.json failed validation: ${parsed.errors.join("; ")}` });
    }

    const files: string[] = [];
    const skills: InstalledAgentPluginSkill[] = [];

    async function walk(absolute: string, prefix: string): Promise<void> {
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(absolute, entry.name), relative);
        } else if (entry.isFile()) {
          files.push(relative);
          const match = relative.match(/^skills\/([^/]+)\/SKILL\.md$/);
          if (match) skills.push({ name: match[1] as string, skillPath: relative });
        }

      }
    }

    await walk(packageRoot, "");

    return {
      pluginId: parsed.manifest.name,
      version: parsed.manifest.version,

      ...(parsed.manifest.description !== undefined ? { description: parsed.manifest.description } : {}),
      ...(parsed.manifest.keywords !== undefined ? { keywords: parsed.manifest.keywords } : {}),
      ...(parsed.manifest.author !== undefined ? { author: parsed.manifest.author } : {}),
      ...(parsed.manifest.license !== undefined ? { license: parsed.manifest.license } : {}),
      archiveDigest,
      packageRoot,
      files: files.sort(),
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async function freezeTree(root: string, executables: ReadonlySet<string>, prefix = ""): Promise<void> {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(root, entry.name);

      if (entry.isDirectory()) {
        await freezeTree(absolute, executables, relative);
        await chmod(absolute, 0o555);
      } else {
        await chmod(absolute, executables.has(relative) ? 0o555 : 0o444);
      }
    }
    await chmod(root, 0o555);
  }

  async function publish(extractionRoot: string, finalRoot: string): Promise<void> {
    try {
      await rename(extractionRoot, finalRoot);
    } catch (error) {

      if (!isErrnoException(error) || (error.code !== "EEXIST" && error.code !== "ENOTEMPTY" && error.code !== "EACCES")) {
        throw new AgentPluginInstallError({ code: "PUBLISH_FAILED", message: `failed to publish the extracted package to '${finalRoot}'` }, { cause: error });
      }
      if (!(await isRealDirectory(finalRoot))) {
        throw new AgentPluginInstallError({ code: "PUBLISH_FAILED", message: `'${finalRoot}' exists but is not a real, published package directory` }, { cause: error });
      }

    }
  }

  async function isRealDirectory(target: string): Promise<boolean> {
    try {
      const info = await stat(target);
      return info.isDirectory();
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }

  function sha256(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
  }

  function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === "object" && error !== null && "code" in error;
  }

  return { maxAgentPluginInstallArchiveBytes, installAgentPlugin, indexInstalledRoot };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createInstallModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
