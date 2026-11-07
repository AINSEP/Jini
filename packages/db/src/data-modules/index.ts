/**
 * @file Public surface for the `plugins` feature. Deliberately narrow: only the ADR-023
 * `dataModule` declaration contract that `comments` and `newsletter` both consume to register
 * their own own-tables (`declareDataModule`, `DataModuleDecl`, `ColumnType`). Everything else
 * under this directory (`lipay/`, `store/`, `migration-recovery.ts`) is reached
 * only from the composition root or the assistant tool-catalog seam, which construct concrete
 * implementations directly by design (ADR-009 §1) — this barrel does not re-export them.
 */
export * from "./data-module.js";
export type { PluginStore as DataModuleStore } from "./plugin-store.js";
export * from "./migration-journal.js";
export * from "./plugin-identity.js";
export * from "./snapshot.js";
export * from "./migration-recovery.js";
export * from "./disk-headroom.js";
export * from "./plugin-store.js";
export * from "./restore.js";
