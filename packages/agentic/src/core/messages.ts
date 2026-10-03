/** Model-facing defaults. Hosts can replace descriptions in the existing CapabilityDef
 * descriptors before projecting tools; canonical descriptor IDs and policy remain unchanged. */
export const defaultAgenticMessages = {
  pageNavigateDescription: () => 'Move to another page, named by its data-agent-page id. Only pages the host has published are reachable; arbitrary URLs are refused. Returns which page was showing before and after, and how many controls each publishes — call page.find_elements again afterwards, since every handle you hold may belong to the page you just left.',
};
