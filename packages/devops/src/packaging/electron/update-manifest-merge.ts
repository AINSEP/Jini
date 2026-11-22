/**
 * @file Merges the two per-arch `latest-mac.yml` update manifests into the one the release carries.
 *
 * The release workflow builds mac-arm64 and mac-x64 on separate runners (each on its own CPU, never
 * cross-built), so each job's electron-builder writes a `latest-mac.yml` listing only ITS zip. A
 * GitHub release can hold one `latest-mac.yml`, and `electron-updater`'s MacUpdater reads that one
 * file on every Mac and picks the zip by arch: a file whose URL contains `arm64` on Apple Silicon,
 * any file WITHOUT `arm64` on Intel. Upload either job's file alone and the other arch updates to a
 * binary for the wrong CPU, or finds no zip at all. So the release job merges them here and refuses
 * anything that would make that choice ambiguous.
 *
 * Only the zips are kept. MacUpdater installs from nothing else, and the dmg entries would be WRONG:
 * the workflow notarizes and staples the dmg after electron-builder wrote this manifest, which
 * changes its bytes, so the checksum listed for it no longer matches the file on the release.
 *
 * Parsing and printing YAML is the caller's job (`scripts/merge-latest-mac.ts`); this file works on
 * the parsed objects so it runs under plain `node --test` with no dependency.
 */

/** One entry of an update manifest's `files` list, as electron-builder writes it. */
interface UpdateFileEntry {
  url: string;
  sha512: string;
  size?: number;
  blockMapSize?: number;
  [key: string]: unknown;
}

/** An electron-builder update manifest (`latest-mac.yml`). */
interface UpdateManifest {
  version: string;
  files: UpdateFileEntry[];
  path?: string;
  sha512?: string;
  releaseDate?: string;
  [key: string]: unknown;
}

const isArm64 = (entry: UpdateFileEntry): boolean => entry.url.includes("arm64");
const isZip = (entry: UpdateFileEntry): boolean => entry.url.endsWith(".zip");

/** @throws {Error} unless `value` has a string `version` and a `files` array of `{url, sha512}`. */
function assertManifest({ value, label }: { value: unknown; label: string }): UpdateManifest {
  const manifest = value as Partial<UpdateManifest> | null;
  if (typeof manifest?.version !== "string" || !Array.isArray(manifest.files)) {
    throw new Error(`${label}: not an update manifest (needs version and files)`);
  }
  for (const entry of manifest.files) {
    if (typeof entry?.url !== "string" || typeof entry.sha512 !== "string") {
      throw new Error(`${label}: every files entry needs url and sha512`);
    }
  }
  return manifest as UpdateManifest;
}

/**
 * @param required.inputs the parsed per-arch manifests, each with a label for error messages.
 * @returns one manifest listing every input's zips (see this file's header for why only zips). Its legacy top-level `path`/`sha512` name the
 *   Intel zip: a very old updater that reads only those gets a build that runs everywhere (Apple
 *   Silicon through Rosetta), never an arm64 build on an Intel Mac.
 * @throws {Error} when the inputs disagree on version, one URL appears with two checksums, or the
 *   result does not hold exactly one arm64 zip and exactly one other zip.
 * @complexity O(n) in files.
 */
function mergeMacManifests({ inputs }: { inputs: ReadonlyArray<{ label: string; manifest: unknown }> }, _options = {}): UpdateManifest {
  if (inputs.length === 0) throw new Error("no manifests to merge");
  const manifests = inputs.map(({ label, manifest }) => assertManifest({ value: manifest, label }));
  const [first] = manifests;
  if (first === undefined) throw new Error("no manifests to merge");
  const mismatch = manifests.find((manifest) => manifest.version !== first.version);
  if (mismatch) throw new Error(`version mismatch: ${first.version} vs ${mismatch.version}`);
  const files = unionFiles({ manifests }).filter(isZip);
  const intelZip = onlyIntelZip({ files });
  const releaseDate = manifests.map((manifest) => manifest.releaseDate).filter((date): date is string => typeof date === "string").sort().at(-1);
  return { ...first, files, path: intelZip.url, sha512: intelZip.sha512, ...(releaseDate ? { releaseDate } : {}) };
}

/** Every input's files, each URL once. @throws {Error} on one URL with two checksums. @complexity O(n). */
function unionFiles({ manifests }: { manifests: readonly UpdateManifest[] }, _options = {}): UpdateFileEntry[] {
  const files = new Map<string, UpdateFileEntry>();
  for (const entry of manifests.flatMap((manifest) => manifest.files)) {
    const seen = files.get(entry.url);
    if (seen && seen.sha512 !== entry.sha512) throw new Error(`${entry.url} listed with two different checksums`);
    files.set(entry.url, entry);
  }
  return [...files.values()];
}

/** @returns the one non-arm64 zip. @throws {Error} unless there is exactly one arm64 zip and one
 *  other zip — the only shape MacUpdater's arch choice is unambiguous for. @complexity O(n). */
function onlyIntelZip({ files }: { files: readonly UpdateFileEntry[] }, _options = {}): UpdateFileEntry {
  const zips = files.filter(isZip);
  const arm = zips.filter(isArm64);
  const intel = zips.filter((entry) => !isArm64(entry));
  const [intelZip] = intel;
  if (arm.length !== 1 || intel.length !== 1 || intelZip === undefined) {
    throw new Error(`expected one arm64 zip and one x64 zip, got [${zips.map((entry) => entry.url).join(", ")}]`);
  }
  return intelZip;
}

export { mergeMacManifests };
export type { UpdateFileEntry, UpdateManifest };
