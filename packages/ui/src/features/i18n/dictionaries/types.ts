/**
 * Shared type for this feature's shipped dictionaries.
 *
 * Intentionally just a re-export of the generic `TranslationDict` shape
 * (flat, string-keyed) rather than a `Dict` interface enumerating every key
 * as a named property: the settings-dialog key set is large (~230 entries as
 * of this writing) and drawn straight from component source, not authored as
 * a fixed API surface -- see `settings-dialog.en.ts`'s doc comment for the
 * enumeration method. A named-property interface would need editing every
 * time a mounted component's `t()` call site changed, duplicating
 * information the parity test (`__tests__/dictionaries.test.ts`) already
 * checks against the dictionaries themselves.
 */
import type { TranslationDict } from '../types.js';

export type SettingsDialogDict = TranslationDict;
