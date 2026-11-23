import { writePagesTabToUrl, type PagesTabId } from "./hooks/pages-tab-url.hooks.js";

/** Keep the local Pages tab and its deep link in step. */
export function createPagesTabSelect({ setActiveTab }: { setActiveTab: (id: PagesTabId) => void }, _options = {}) {
  return (id: PagesTabId) => { setActiveTab(id); writePagesTabToUrl({ tab: id }); };
}
