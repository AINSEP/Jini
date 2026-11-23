/**
 * @file Who moved an item to the trash. Types only.
 *
 * Owner of this declaration; `@jini-ai/cms/trash` (`trash/ports.ts`) re-exports the type from here.
 * The trash service, its adapters and
 * the cms `RemoveEntity` port stay in the cms package (the cms `RemoveEntity` differs from the
 * structural one in `./plugins-host`, so it is not copied here).
 */

export interface TrashActor {
  principalId: string;
  pluginId?: string | null;
}
