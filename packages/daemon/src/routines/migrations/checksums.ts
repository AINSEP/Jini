/**
 * @file Pinned checksums of the routine sidecar's migration steps. The runner records these in
 * `jini_routine_migrations` and the store refuses a database whose recorded checksum differs.
 * `../__tests__/routines-migration-pin.test.ts` re-derives each from its `NNNN_name.ts` source
 * (comments removed, whitespace collapsed, sha256), so an edit to a shipped step goes red instead of
 * silently differing between databases. Pinned rather than computed at runtime: tsx runs the `.ts`
 * and production runs tsc output, which would hash differently. Never change a shipped pin.
 */
export const JINI_ROUTINES_MIGRATION_CHECKSUMS: Readonly<Record<string, string>> = {
  '0001_jini_routines_v1': '95c75807894a477dcb3eeac8192c5a5e17fe1acafec2bc0b839cd30e0a8377b2',
};
