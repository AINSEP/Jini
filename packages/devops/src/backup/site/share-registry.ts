import { randomInt, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { SiteShareRefusal } from "./share-refusal.js";
import type { SealedSecret } from "@jini-ai/core/contracts/vault";
import type { CredentialWarning } from "./credential-warnings.js";
import { isShareExpired } from "./share-expiry.js";

/** Host values the registry cannot own: its artifact naming, the public file-name shape and the archive size cap. */
export interface ShareRegistryHost {
  /** Suffix of the private artifact file kept beside each record (for example `.share.zip`). */
  readonly artifactSuffix: string;
  /** Accepts the public file names this host mints; a token is only ever served with a matching file. */
  readonly shareFile: RegExp;
  /** Largest archive the registry will write, in bytes. */
  readonly maxArchiveBytes: number;
}

export interface SiteShareRecord {
  readonly shareId: string;
  readonly token: string;
  readonly site: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly url: string | null;
  readonly status: "active" | "revoked" | "failed" | "expired";
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly hasEncryptedKeys?: boolean;
  readonly sealedPassword?: SealedSecret;
  readonly notices?: readonly string[];
  readonly credentialWarnings?: readonly CredentialWarning[];
  readonly needsAcknowledgement?: boolean;
  readonly notes?: readonly string[];
  readonly storage?: { readonly provider: string; readonly key: string; readonly url?: string; readonly binding?: string };
  /** Set only at creation from the owner's choice, never changed after. Absent or null: the link never expires. */
  readonly expiresAt?: string | null;
}
const ID = /^[0-9a-f-]{36}$/;
/** Owner decision 2026-10-25: share tokens are 16 ASCII letters (~91 bits), short enough to read
 * aloud yet unguessable. No digits, and no other shape is accepted: old 64-hex links are dead.
 * The one source of the token shape; route and object-store key checks build on SHARE_TOKEN_PATTERN. */
const ASCII_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHARE_TOKEN_ALPHABET = ASCII_LETTERS;
export const SHARE_TOKEN_LENGTH = 16;
export const SHARE_TOKEN_PATTERN = `[A-Za-z]{${SHARE_TOKEN_LENGTH}}`;
export const SHARE_TOKEN = new RegExp(`^${SHARE_TOKEN_PATTERN}$`);

/**
 * Private per-site share catalog, outside every backup walk and public static root. One atomic
 * metadata file per export prevents unrelated concurrent creates from overwriting each other.
 * Revocation is a permanent create-only tombstone: a racing upload can never resurrect access.
 * @complexity O(exports) listing; O(1) token lookup/updates, plus artifact bytes on disk.
 */
export class SiteShareRegistry {
  readonly directory: string;
  private readonly host: ShareRegistryHost;
  private readonly now: () => number;
  /** @param optional.now The host clock (epoch ms) the public lookup compares `expiresAt` against; a host should inject its own. */
  constructor(required: { directory: string; host: ShareRegistryHost }, optional: { now?: () => number } = {}) { this.directory = required.directory; this.host = required.host; this.now = optional.now ?? Date.now; }
  private meta({ id }: { id: string }, _optional: Record<string, never> = {}): string {
    if (!ID.test(id)) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Invalid shareId." });
    return path.join(this.directory, `${id}.json`);
  }
  artifactPath(required: { shareId: string }, _optional: Record<string, never> = {}): string {
    this.meta({ id: required.shareId });
    return path.join(this.directory, `${required.shareId}${this.host.artifactSuffix}`);
  }
  /** Immutable token-to-id claim gives O(1) public lookups and forbids replay after revocation. */
  async reserveToken(required: { token: string; shareId: string }, _optional: Record<string, never> = {}): Promise<void> {
    if (!SHARE_TOKEN.test(required.token)) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Invalid share token." });
    this.meta({ id: required.shareId });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${required.token}.token`);
    try { await writeFile(file, required.shareId, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await readFile(file, "utf8") !== required.shareId) throw new SiteShareRefusal({ code: "TOKEN_EXISTS", message: "This share token has already been used. Create a new export." });
    }
  }
  async put(required: { record: SiteShareRecord }, _optional: Record<string, never> = {}): Promise<void> {
    await this.reserveToken(required.record);
    await this.writeRecord(required.record);
  }
  /** Atomic metadata write with no token-shape check, so `disable` can still tombstone a row minted
   * before the 16-letter switch (its token was reserved when it was created). */
  private async writeRecord(record: SiteShareRecord): Promise<void> {
    const temp = path.join(this.directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(record), { flag: "wx", mode: 0o600 });
      await rename(temp, this.meta({ id: record.shareId }));
    } finally { await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  async get(required: { shareId: string; site?: string }, _optional: Record<string, never> = {}): Promise<SiteShareRecord | null> {
    const stored = await this.readRow(required.shareId);
    if (!stored) return null;
    const row = { ...stored, credentialWarnings: stored.credentialWarnings ?? [], needsAcknowledgement: stored.needsAcknowledgement ?? false };
    if (required.site !== undefined && row.site !== required.site) return null;
    const revokedAt = await this.readTombstone(`${row.shareId}.revoked`);
    if (revokedAt !== null) return { ...row, status: "revoked", revokedAt };
    // Checked after `.revoked` so `revoked > expired`; like revocation, a racing whole-record `put`
    // (acknowledge, delivery rewrite) cannot bring an expired link back to `active`.
    if (await this.readTombstone(`${row.shareId}.expired`) !== null) return { ...row, status: "expired" };
    return row;
  }
  private async readRow(shareId: string): Promise<SiteShareRecord | null> {
    try { return JSON.parse(await readFile(this.meta({ id: shareId }), "utf8")) as SiteShareRecord; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { return null; } throw error; }
  }
  /** A tombstone's content, or null when it does not exist; any other read error propagates. */
  private async readTombstone(name: string): Promise<string | null> {
    try { return await readFile(path.join(this.directory, name), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return null; }
  }
  /**
   * The permanent, create-only expiry tombstone (content: the stated `expiresAt`), synced to disk
   * before returning so the artifact is never unlinked while a reader could still see `active`.
   * An existing tombstone is success: a crash between this and the unlink is retried by the next pass.
   */
  async markExpired(required: { shareId: string; expiresAt: string }, _optional: Record<string, never> = {}): Promise<void> {
    this.meta({ id: required.shareId });
    const file = path.join(this.directory, `${required.shareId}.expired`);
    let handle: Awaited<ReturnType<typeof open>>;
    try { handle = await open(file, "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return; throw error; }
    try { await handle.writeFile(required.expiresAt); await handle.sync(); }
    finally { await handle.close(); }
  }
  async list(required: { site?: string }, _optional: Record<string, never> = {}): Promise<SiteShareRecord[]> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { return []; } throw error; }
    const rows: SiteShareRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || !ID.test(name.slice(0, -5))) continue;
      const row = await this.get({ shareId: name.slice(0, -5), ...required });
      if (row) rows.push(row);
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async findToken(required: { token: string; file: string }, _optional: Record<string, never> = {}): Promise<SiteShareRecord | null> {
    if (!SHARE_TOKEN.test(required.token) || !this.host.shareFile.test(required.file)) return null;
    let shareId: string;
    try { shareId = await readFile(path.join(this.directory, `${required.token}.token`), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { return null; } throw error; }
    const row = await this.get({ shareId });
    return row && servesToken({ row, ...required }) && !isShareExpired({ row, now: this.now() }) ? row : null;
  }
  async disable(required: { shareId: string; site: string }, _optional: Record<string, never> = {}): Promise<SiteShareRecord | null> {
    const row = await this.get(required);
    if (!row) return null;
    const revokedAt = row.revokedAt ?? new Date().toISOString();
    try { await writeFile(path.join(this.directory, `${row.shareId}.revoked`), revokedAt, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const revoked = { ...row, status: "revoked" as const, revokedAt };
    await this.writeRecord(revoked);
    return revoked;
  }
  async writeArtifact(required: { shareId: string; bytes: Buffer }, _optional: Record<string, never> = {}): Promise<void> {
    if (required.bytes.length > this.host.maxArchiveBytes) throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: "Share exceeds the 300 MiB archive cap." });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const space = await statfs(this.directory);
    if (space.bavail * space.bsize < required.bytes.length + 16 * 1024 * 1024) throw new SiteShareRefusal({ code: "INSUFFICIENT_STORAGE", message: "Insufficient private storage for this ZIP and 16 MiB of working space." });
    await writeFile(this.artifactPath(required), required.bytes, { flag: "wx", mode: 0o600 });
  }
  /** Read the same private artifact this registry wrote; paths never come from HTTP input.
   * @complexity O(archive bytes), bounded by the share archive cap.
   */
  async readArtifact(required: { shareId: string }, _optional: Record<string, never> = {}): Promise<Buffer> {
    return readFile(this.artifactPath(required));
  }
  async deleteArtifact(required: { shareId: string }, _optional: Record<string, never> = {}): Promise<void> {
    await unlink(this.artifactPath(required)).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

/** A public token serves only its own active, acknowledged file. */
function servesToken({ row, token, file }: { row: SiteShareRecord; token: string; file: string }, _optional = {}): boolean {
  return row.token === token && row.file === file && row.status === "active" && !row.needsAcknowledgement && !row.credentialWarnings?.length;
}

/**
 * A fresh share id and public token. `randomInt` draws from the CSPRNG and rejection-samples, so each
 * of the 52 letters is equally likely (no modulo bias): 16 draws give log2(52^16) ≈ 91 bits.
 * @complexity O(SHARE_TOKEN_LENGTH).
 */
export function newShareIdentity(_required: Record<string, never>, _optional: Record<string, never> = {}): { shareId: string; token: string } {
  const token = Array.from({ length: SHARE_TOKEN_LENGTH }, () => SHARE_TOKEN_ALPHABET[randomInt(SHARE_TOKEN_ALPHABET.length)]).join("");
  return { shareId: randomUUID(), token };
}
