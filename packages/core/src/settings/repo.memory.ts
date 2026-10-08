import type { SettingsRepoPort } from "./ports.js";
import type { SettingDefinitionRecord, SettingRevisionRecord, SettingValueRecord } from "./types.js";

/**
 * @file In-memory adapter for `SettingsRepoPort` (the rule-of-two: in-memory + production adapters).
 *
 * Purpose:
 * Test/dev implementation. Mirrors the exact style of `identity/repo.memory.ts`:
 * constructor takes seed rows, methods filter/mutate internal arrays.
 *
 * `transaction` is a real snapshot/restore journal, not a no-op wrapper. It
 * used to be `async (fn) => fn()` on the reasoning that each individual
 * mutation is already synchronous and atomic in-process — true, but the
 * guarantee `SettingsRepoPort.transaction` actually sells is that a COMPOSITE
 * of several mutations is all-or-nothing. `resetNamespace` clears a whole
 * namespace inside one transaction; under a no-op wrapper a failure partway
 * through left the namespace half reset while the caller saw an error. This
 * adapter is a common wired default for dev/test composition, so that was
 * live in dev, and the contract suite could not see it because the rollback
 * assertion only ran against the SQLite adapter.
 */
export class InMemorySettingsRepo implements SettingsRepoPort {
  private definitions: SettingDefinitionRecord[];
  private globalValues: SettingValueRecord[];
  private workspaceValues: SettingValueRecord[];
  private userValues: SettingValueRecord[];
  private revisions: SettingRevisionRecord[];
  private nextSeq: number;
  /** True while `transaction` is open — see its doc for why this refuses
   *  rather than nests. */
  private inTransaction = false;

  constructor(
    seed: {
      definitions?: SettingDefinitionRecord[];
      globalValues?: SettingValueRecord[];
      workspaceValues?: SettingValueRecord[];
      userValues?: SettingValueRecord[];
      revisions?: SettingRevisionRecord[];
    } = {}
  ) {
    this.definitions = [...(seed.definitions ?? [])];
    this.globalValues = [...(seed.globalValues ?? [])];
    this.workspaceValues = [...(seed.workspaceValues ?? [])];
    this.userValues = [...(seed.userValues ?? [])];
    this.revisions = [...(seed.revisions ?? [])];
    this.nextSeq = (seed.revisions?.reduce((max, r) => Math.max(max, r.seq), 0) ?? 0) + 1;
  }

  async findActiveDefinition(required: {
    namespace: string;
    key: string;
    workspaceId: string | null;
  }): Promise<SettingDefinitionRecord | null> {
    // Matches active/alias/tombstone (the "current" row for this (ns,key,ws)
    // slot — callers decide how to react to each status, e.g. settings.ts
    // treats tombstone as read-absent but write-service.ts reports it
    // distinctly as DEFINITION_TOMBSTONED). Deliberately excludes
    // `deprecated`: those are stale prior-version rows superseded by a newer
    // active row at the same (ns,key,ws) slot (the retype mechanism), so
    // including them would make this lookup ambiguous.
    return (
      this.definitions.find(
        (d) =>
          d.namespace === required.namespace &&
          d.key === required.key &&
          d.workspaceId === required.workspaceId &&
          (d.status === "active" || d.status === "alias" || d.status === "tombstone")
      ) ?? null
    );
  }

  async findDefinitionBySettingId(required: {
    settingId: string;
    version?: number;
  }): Promise<SettingDefinitionRecord | null> {
    const candidates = this.definitions.filter((d) => d.settingId === required.settingId);
    if (required.version != null) {
      return candidates.find((d) => d.version === required.version) ?? null;
    }
    return (
      candidates.find((d) => d.status === "active") ??
      candidates.sort((a, b) => b.version - a.version)[0] ??
      null
    );
  }

  async listActiveDefinitions(required: { workspaceId: string | null }): Promise<SettingDefinitionRecord[]> {
    return this.definitions.filter(
      (d) => d.workspaceId === required.workspaceId && (d.status === "active" || d.status === "alias")
    );
  }

  async saveDefinition(record: SettingDefinitionRecord): Promise<void> {
    const index = this.definitions.findIndex(
      (d) => d.settingId === record.settingId && d.version === record.version
    );
    if (index === -1) {
      this.definitions.push(record);
      return;
    }
    this.definitions[index] = record;
  }

  async getGlobalValue(settingId: string): Promise<SettingValueRecord | null> {
    return this.globalValues.find((v) => v.settingId === settingId) ?? null;
  }

  async getWorkspaceValue(required: {
    workspaceId: string;
    settingId: string;
  }): Promise<SettingValueRecord | null> {
    return (
      this.workspaceValues.find(
        (v) => v.workspaceId === required.workspaceId && v.settingId === required.settingId
      ) ?? null
    );
  }

  async getUserValue(required: {
    workspaceId: string;
    principalId: string;
    settingId: string;
  }): Promise<SettingValueRecord | null> {
    return (
      this.userValues.find(
        (v) =>
          v.workspaceId === required.workspaceId &&
          v.principalId === required.principalId &&
          v.settingId === required.settingId
      ) ?? null
    );
  }

  async saveGlobalValue(record: SettingValueRecord): Promise<void> {
    const index = this.globalValues.findIndex((v) => v.settingId === record.settingId);
    if (index === -1) {
      this.globalValues.push(record);
      return;
    }
    this.globalValues[index] = record;
  }

  async saveWorkspaceValue(record: SettingValueRecord): Promise<void> {
    const index = this.workspaceValues.findIndex(
      (v) => v.workspaceId === record.workspaceId && v.settingId === record.settingId
    );
    if (index === -1) {
      this.workspaceValues.push(record);
      return;
    }
    this.workspaceValues[index] = record;
  }

  async saveUserValue(record: SettingValueRecord): Promise<void> {
    const index = this.userValues.findIndex(
      (v) =>
        v.workspaceId === record.workspaceId &&
        v.principalId === record.principalId &&
        v.settingId === record.settingId
    );
    if (index === -1) {
      this.userValues.push(record);
      return;
    }
    this.userValues[index] = record;
  }

  async listWorkspaceValues(required: { workspaceId: string }): Promise<SettingValueRecord[]> {
    return this.workspaceValues.filter((v) => v.workspaceId === required.workspaceId);
  }

  async listUserValues(required: { workspaceId: string; principalId: string }): Promise<SettingValueRecord[]> {
    return this.userValues.filter(
      (v) => v.workspaceId === required.workspaceId && v.principalId === required.principalId
    );
  }

  async listUserValuesByWorkspace(required: { workspaceId: string }): Promise<SettingValueRecord[]> {
    return this.userValues.filter((v) => v.workspaceId === required.workspaceId);
  }

  async deleteWorkspaceValue(required: { workspaceId: string; settingId: string }): Promise<void> {
    this.workspaceValues = this.workspaceValues.filter(
      (v) => !(v.workspaceId === required.workspaceId && v.settingId === required.settingId)
    );
  }

  async deleteUserValue(required: { workspaceId: string; principalId: string; settingId: string }): Promise<void> {
    this.userValues = this.userValues.filter(
      (v) =>
        !(
          v.workspaceId === required.workspaceId &&
          v.principalId === required.principalId &&
          v.settingId === required.settingId
        )
    );
  }

  async appendRevision(record: Omit<SettingRevisionRecord, "seq">): Promise<number> {
    const seq = this.nextSeq++;
    this.revisions.push({ ...record, seq });
    return seq;
  }

  async listRevisions(required: { settingId: string }): Promise<SettingRevisionRecord[]> {
    return this.revisions.filter((r) => r.settingId === required.settingId).sort((a, b) => a.seq - b.seq);
  }

  async listRevisionsSince(required: {
    sinceSeq: number;
    limit: number;
    workspaceId: string;
  }): Promise<SettingRevisionRecord[]> {
    return this.revisions
      .filter(
        (r) =>
          r.seq > required.sinceSeq &&
          // Mirrors the SQL predicate exactly — see the port's doc. `null` means
          // platform-wide (every workspace resolves through it); anything else is one tenant's.
          (r.workspaceId === null || r.workspaceId === required.workspaceId)
      )
      .sort((a, b) => a.seq - b.seq)
      .slice(0, required.limit);
  }

  async maxRevisionSeq(): Promise<number> {
    return this.revisions.reduce((max, r) => (r.seq > max ? r.seq : max), 0);
  }

  /**
   * Runs `fn` atomically: every mutation it makes is discarded if it throws.
   *
   * A shallow copy of each array is enough because no method here mutates a
   * record in place — `save*` REPLACES the element at its index, `delete*`
   * reassigns a filtered array, `appendRevision` pushes. Restoring the arrays
   * therefore restores the rows too. If a future method starts editing a
   * record object in place, this must deep-copy instead.
   *
   * `nextSeq` is rolled back with the rest, matching SQLite: `sqlite_sequence`
   * is an ordinary table, so an AUTOINCREMENT counter bumped inside a
   * transaction is undone by its ROLLBACK. A seq handed out by a failed
   * transaction is safe to reuse precisely because that revision no longer
   * exists.
   *
   * **Deliberately NOT reentrant**, matching a SQLite adapter's `transaction`,
   * where `BEGIN IMMEDIATE` inside an open transaction is an error. Refusing
   * loudly is the point: an instance-level flag cannot tell "nested inside my
   * caller's transaction" from "an unrelated transaction that started while
   * mine was awaiting". Silently joining a stranger's transaction — and
   * inheriting its rollback — is a worse defect than refusing. A caller that
   * needs several writes to commit together opens ONE transaction and passes
   * `skipTransaction` to the inner writes, as `resetNamespace` does.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      throw new Error(
        "InMemorySettingsRepo.transaction is not reentrant, and cannot host a second overlapping transaction. " +
          "Open one transaction and pass `skipTransaction` to the inner writes (see resetNamespace)."
      );
    }
    const snapshot = {
      definitions: [...this.definitions],
      globalValues: [...this.globalValues],
      workspaceValues: [...this.workspaceValues],
      userValues: [...this.userValues],
      revisions: [...this.revisions],
      nextSeq: this.nextSeq,
    };
    this.inTransaction = true;
    try {
      return await fn();
    } catch (error) {
      this.definitions = snapshot.definitions;
      this.globalValues = snapshot.globalValues;
      this.workspaceValues = snapshot.workspaceValues;
      this.userValues = snapshot.userValues;
      this.revisions = snapshot.revisions;
      this.nextSeq = snapshot.nextSeq;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
}
