import { sql, type RawBuilder } from "kysely";
import type { KeyAttachments } from "@jini-ai/core/contracts/site/project-key-attachments";

type Empty = Record<string, never>;

export interface AttachmentSqlPort {
  readonly dialect: string;
  query<Row>(statement: RawBuilder<unknown>, optional?: Empty): Promise<readonly Row[]>;
  execute(statement: RawBuilder<unknown>, optional?: Empty): Promise<unknown>;
}

export interface AttachmentPolicy {
  ownerWorkspaceId: string;
  customKind: string;
  vendorKind: string;
  vendorCredentialType: string;
  maxGrants: number;
  tooManyKeys: string;
  ambiguousLabel: string;
  noSiteId: string;
}

/** A vault row's `meta.worksFor` labels; SQLite hands `meta` back as JSON text, Postgres as an object. */
function worksForOf(meta: string | Record<string, unknown>): readonly unknown[] {
  const parsed = typeof meta === "string" ? (JSON.parse(meta) as Record<string, unknown>) : meta;
  return Array.isArray(parsed.worksFor) ? parsed.worksFor : [];
}

/** One indexed lookup per check; no cache so attach/detach changes the next credential read. */
export function createKeyAttachments({ sql: kernel, tables, nowIso, policy, credentialTypeText }: {
  sql: AttachmentSqlPort;
  tables: { attachments: string; vault: string };
  nowIso: () => string;
  policy: AttachmentPolicy;
  credentialTypeText: (required: { column: RawBuilder<unknown> }, optional?: Empty) => RawBuilder<string | null>;
}, _optional: Empty = {}): KeyAttachments {
  for (const name of [tables.attachments, tables.vault]) {
    if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error("Invalid attachment table identifier.");
  }
  return {
    async keyForLabel({ siteId, label }) {
      if (!siteId) return null;
      // The `worksFor` array lives in JSON the dialect helpers cannot search, so match it here: the rows are
      // this one site's attachments, which `keysFor` also caps at 100.
      const credentialType = credentialTypeText({ column: sql.ref("v.meta") });
      const candidates = await kernel.query<{ key_id: string; label: string; meta: string | Record<string, unknown> }>(sql`SELECT a.key_id, v.label, v.meta FROM ${sql.table(tables.vault)} v JOIN ${sql.table(tables.attachments)} a ON a.key_id=v.id AND a.site_id=${siteId} WHERE v.workspace_id=${policy.ownerWorkspaceId} AND (v.kind=${policy.customKind} OR (v.kind=${policy.vendorKind} AND ${credentialType}=${policy.vendorCredentialType})) ORDER BY a.key_id LIMIT ${policy.maxGrants + 1}`);
      if (candidates.length > policy.maxGrants) throw new Error(policy.tooManyKeys);
      const rows = candidates.filter(row => row.label === label || worksForOf(row.meta).includes(label));
      if (rows.length > 1) throw new Error(policy.ambiguousLabel);
      return rows[0]?.key_id ?? null;
    },
    async keysFor({ siteId }) {
      if (!siteId) return [];
      const rows = await kernel.query<{ key_id: string }>(sql`SELECT key_id FROM ${sql.table(tables.attachments)} WHERE site_id=${siteId} ORDER BY key_id LIMIT ${policy.maxGrants + 1}`);
      if (rows.length > policy.maxGrants) throw new Error(policy.tooManyKeys);
      return rows.map(row => row.key_id);
    },
    async attach({ siteId, keyId, siteName }) {
      if (!siteId) throw new Error(policy.noSiteId);
      await kernel.execute(sql`INSERT INTO ${sql.table(tables.attachments)} (site_id, key_id, site_name, attached_at) VALUES (${siteId}, ${keyId}, ${siteName}, ${nowIso()}) ON CONFLICT (site_id, key_id) DO NOTHING`);
    },
    detach: async ({ siteId, keyId }) => { await kernel.execute(sql`DELETE FROM ${sql.table(tables.attachments)} WHERE site_id=${siteId} AND key_id=${keyId}`); },
    async isAttached({ siteId, keyId }) {
      if (!siteId) return false;
      return (await kernel.query(sql`SELECT 1 FROM ${sql.table(tables.attachments)} WHERE site_id=${siteId} AND key_id=${keyId}`)).length > 0;
    },
    async usersOf({ keyId }) {
      const rows = await kernel.query<{ site_id: string; site_name: string }>(sql`SELECT site_id, site_name FROM ${sql.table(tables.attachments)} WHERE key_id=${keyId} ORDER BY site_name, site_id`);
      return rows.map(row => ({ siteId: row.site_id, siteName: row.site_name }));
    },
    removeKey: async ({ keyId }) => { await kernel.execute(sql`DELETE FROM ${sql.table(tables.attachments)} WHERE key_id=${keyId}`); },
    renameSite: async ({ siteId, siteName }) => { await kernel.execute(sql`UPDATE ${sql.table(tables.attachments)} SET site_name=${siteName} WHERE site_id=${siteId}`); },
  };
}
