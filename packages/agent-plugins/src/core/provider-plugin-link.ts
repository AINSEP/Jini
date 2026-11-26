import type { ProviderFacePorts } from "../site/provider-plugin-link.js";

/** The provider plugin `pluginId` is the face of, or undefined when it declares none. @complexity As `links`. */
export async function linkedProviderOf({ ports, pluginId }: { ports: Pick<ProviderFacePorts, "links">; pluginId: string }, _optional: Record<string, never> = {}): Promise<string | undefined> {
  return (await ports.links({})).get(pluginId);
}

