import { sql, type RawBuilder } from 'kysely';

// Weak identity metadata only, never row data. Closing/replacing a kernel releases its epoch with GC.
const epochs = new WeakMap<object, string>();

/** SQLite invalidation without scanning message rows. Both same-connection writes and external
 * commits invalidate; the kernel epoch prevents counters reused after reopen from hiding changes.
 * @param required.kernel The existing borrowed connection identity; never opens or changes it.
 * @param optional.mintEpoch Injectable epoch source, called once per live kernel.
 * @returns A SQL scalar with bounded output, without event/content reads or writes.
 * @complexity O(1) time and weak identity space per kernel.
 * @example sqliteReadVersion({ kernel });
 */
export function sqliteReadVersion({ kernel }: { kernel: object },
  { mintEpoch = () => globalThis.crypto.randomUUID() }: { mintEpoch?: () => string } = {},
): RawBuilder<string> {
  let epoch = epochs.get(kernel);
  if (epoch === undefined) { epoch = mintEpoch(); epochs.set(kernel, epoch); }
  // Connection-wide counters invalidate every row on any chat.db write; concurrent chats can erase the cache savings.
  return sql<string>`${epoch} || ':' || cast(total_changes() as text) || ':' || cast((select data_version from pragma_data_version) as text)`;
}
