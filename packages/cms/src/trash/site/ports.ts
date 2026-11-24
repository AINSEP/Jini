/**
 * @file Port contracts for the local admin Trash (phase 1 — Posts, Comments, Media, Redirects).
 *
 * Design of record: `ADS-memory/reports/2026-09-20-trash-delete-architecture.md`. Read §1.1 before
 * changing anything here: the whole shape exists so that **a trash operation never round-trips the
 * entity payload, and listing the trash never reads the entity at all**. `widgets_trash_instance`
 * is the counter-example — it parses `fields_json` to flip a status, so it fails on exactly the
 * corrupt rows a user most wants gone.
 *
 * Two structural rules this file encodes by signature rather than by discipline:
 *
 *  1. `TrashPort.trash` takes `display` as a REQUIRED argument. The caller already holds the record
 *     (it loaded it for its own permission/version checks), so the snapshot comes from columns it
 *     has in hand. The port therefore cannot read the entity even if someone wanted it to.
 *  2. `TrashAdapter` has exactly `hide` / `unhide` / `purge`. There is deliberately **no
 *     `describe()`** — an adapter method that can throw on read would eventually be called from the
 *     list path and the list would start 500ing on corrupt rows. The way to make that impossible is
 *     for the method not to exist.
 *
 * The shared contracts those rules govern (`TrashPort`, `TrashAdapter`) now live in
 * `@jini-ai/cms/trash`; this file keeps the host removal/transaction contracts.
 *
 * INTERFACES + TYPES ONLY — no logic lives here.
 */
import type { TrashActor, TrashDisplay, TrashMarkerResult } from "../index.js";

/**
 * Retention window for locally trashed items, in days.
 *
 * Stamped into `trashed_items.purge_after` at trash time rather than computed at read time, so
 * lowering this constant later can never retroactively purge something a user was already promised.
 *
 * 30 days (owner decision P10 G7-4, was 60): the same promise the admin Trash screen states. Only
 * items trashed after this change get the shorter stamp; rows already trashed keep their 60-day one.
 */
export const TRASH_RETENTION_DAYS = 30;

/**
 * The function a domain's delete path receives through its own dependency object.
 *
 * Pre-bound at the composition root with that domain's `entityType`, so `post.ts`,
 * `redirects.ts`, the comments write-service and the media route import **no trash type and no
 * trash module**. They know only that deleting is something they delegate.
 */
export type RemoveEntity = (required: {
  workspaceId: string;
  id: string;
  display: TrashDisplay;
  at: string;
  expectedVersion: number | null;
  actor: TrashActor;
  /** Legacy widget adoption supplies its payload status here; composition forwards it as a Jini option. */
  priorMarker?: string | null;
}) => Promise<TrashMarkerResult>;

/**
 * Runs `fn` inside one database transaction.
 *
 * MUST be reentrant: a domain whose delete path already opened a transaction (posts and redirects
 * both do — their marker write and revision-ledger append are one unit) calls straight through to
 * `remove`, and a nested `BEGIN IMMEDIATE` would throw. Passing through preserves both-or-neither
 * exactly, because a throw inside propagates to the outer `ROLLBACK`.
 */
export type TransactionRunner = <T>(fn: () => Promise<T>) => Promise<T>;
