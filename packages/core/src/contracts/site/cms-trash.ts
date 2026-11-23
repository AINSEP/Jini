/**
 * @file Who moved an item to the trash. Types only.
 *
 * Additive copy of the declaration in `@jini-ai/cms/trash` (`trash/ports.ts`), which keeps its
 * identical declaration and export until the paired cutover. The trash service, its adapters and
 * the cms `RemoveEntity` port stay in the cms package (the cms `RemoveEntity` differs from the
 * structural one in `./plugins-host`, so it is not copied here).
 */

export interface TrashActor {
  principalId: string;
  pluginId?: string | null;
}
