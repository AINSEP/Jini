/**
 * @file Durable JSON file read-state, quarantine-notice and lock-option shapes. Types only; this
 * module owns the declarations that `@jini-ai/platform/fs/durable-json` (`fs/durable-json.ts`) used
 * to declare. That package imports them from here and keeps its runtime values.
 */

// Missing is not unreadable: a damaged file holds unknown records, not a valid empty list. Retain
// text for salvage when reading succeeded but parsing failed; I/O failure supplies no recoverable text.
export type JsonFileRead = { state: "ok"; value: unknown } | { state: "missing" } | { state: "unreadable"; text?: string };
export interface QuarantineNotice { label: string; consequence: string; }
export interface FileLockOptions { waitMs?: number; }
