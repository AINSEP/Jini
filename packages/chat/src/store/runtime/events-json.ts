import { sql } from "kysely";
import type { AgentEvent } from "../../core/index.js";

/** Replace a compact array's suffix without transferring the stored prefix to JS.
 * SQL length/substr count characters on SQLite and PostgreSQL, including non-BMP text.
 * @complexity One SQL string splice; only the new suffix crosses the kernel boundary. */
export function spliceEventsJson(
  { removeCharacters, suffix }: { removeCharacters: number; suffix: string }, _options = {},
) {
  return sql<string>`substr(events_json, 1, length(events_json) - ${removeCharacters}) || cast(${suffix} as text)`;
}

/** `events_json` with one more event, built in SQL: no dialect parses or re-serializes the saved
 * array in JS. Writers store `JSON.stringify` output (no whitespace), so a non-empty array is
 * `[...]` and gains `,event`; `[]`, NULL and anything not array-shaped (a truncated legacy value,
 * which the old JS read also treated as no events) become `[event]`. Plain `substr`/`length`/`||`
 * run unchanged on SQLite and PostgreSQL. */
export function appendedEventsJson({ event }: { event: AgentEvent }, _optional = {}) {
  const item = JSON.stringify(event);
  const suffix = spliceEventsJson({ removeCharacters: 1, suffix: ',' + item + ']' });
  const empty = '[' + item + ']';
  return sql<string>`case when events_json like '[_%]' then ${suffix} else cast(${empty} as text) end`;
}
