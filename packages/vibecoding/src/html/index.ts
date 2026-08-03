/**
 * @module html
 *
 * The single-document `EditTarget`: parts are tagged regions of one HTML document.
 *
 * Framework-free like `/core` — the HTML parser arrives as an injected port rather than a
 * dependency, so this entry point stays usable from a server, a worker or a browser without
 * dragging a parser into any of them.
 */
export type {
  HtmlDocumentStore,
  HtmlRegionParser,
  HtmlRegionTargetDeps,
  HtmlRegionTargetOptions,
  ParsedRegion,
} from "./regions.js";
export {
  AGENT_ELEMENT_ATTRIBUTE,
  createHtmlRegionTarget,
  isValidRegionHandle,
} from "./regions.js";
