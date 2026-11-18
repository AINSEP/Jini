import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely, Selectable } from "kysely";
import type { MenuStatus, NavLocationBindingRow, NavMenuDoc, NavMenuEntry } from "../types.js";

/**
 * @file Row types and mapping for the host's menu and nav-location-binding tables, shared by every dialect.
 * The column sets are copied from the host's generated schema in the same key order; the host's own type-level
 * pin fails if a later copy drifts from it. The table NAMES are host-owned ({@link NavigationTables}).
 *
 * JSON columns: `doc_json`/`locations_json` hold compact JSON text (a Postgres `jsonb`, read back as
 * compact text by the driver), always parsed on read — key order is not part of the contract, so
 * jsonb reordering object keys changes nothing a caller sees.
 */

export interface MenuTableRow {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  status: string;
  doc_json: string;
  locations_json: string;
  updated_at: string;
  version: number;
}

export interface NavLocationBindingTableRow {
  workspace_id: string;
  location_key: string;
  menu_id: string;
  bound_at: string;
}

/** Host-owned table names. No schema or product table defaults live in the adapter. */
export interface NavigationTables { menus: string; navLocationBindings: string }
export interface NavigationSqlRequired { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: NavigationTables }
/** Type aliases of `Record<string, Row>`, not interfaces: Kysely's `withTables` needs the implicit index signature. */
export type MenuTableViews = Record<string, MenuTableRow>;
export type NavLocationBindingTableViews = Record<string, NavLocationBindingTableRow>;

export function toMenuRecord(row: Selectable<MenuTableRow>): NavMenuEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    title: row.title,
    status: row.status as MenuStatus,
    doc: JSON.parse(row.doc_json) as NavMenuDoc,
    locations: JSON.parse(row.locations_json) as string[],
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function toBindingRecord(row: Selectable<NavLocationBindingTableRow>): NavLocationBindingRow {
  return {
    workspaceId: row.workspace_id,
    locationKey: row.location_key,
    menuId: row.menu_id,
    boundAt: row.bound_at,
  };
}

export function toBindingRow(binding: NavLocationBindingRow): NavLocationBindingTableRow {
  return {
    workspace_id: binding.workspaceId,
    location_key: binding.locationKey,
    menu_id: binding.menuId,
    bound_at: binding.boundAt,
  };
}
