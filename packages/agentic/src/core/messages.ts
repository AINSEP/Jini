/** Model-facing defaults. Hosts can replace descriptions in the existing CapabilityDef
 * descriptors before projecting tools; canonical descriptor IDs and policy remain unchanged. */
export const defaultAgenticMessages = {
  pageNavigateDescription: () => 'Open, bring up, show me, or go to a published UI screen. Resolve entity targets through the published map; a returned nextAction is a discovery query, never an implicit click. Move to another page, named by its data-agent-page id. Only pages the host has published are reachable; arbitrary URLs are refused. Returns which page was showing before and after, and how many controls each publishes — call page.find_elements again afterwards, since every handle you hold may belong to the page you just left.',
};
