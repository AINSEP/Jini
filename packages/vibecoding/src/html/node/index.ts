/**
 * @module html/node
 *
 * The Node-only `HtmlRegionParser` implementation for `../regions.js`'s injected port — parse5,
 * because that dependency is the one thing keeping `./html` itself framework- and runtime-free. See
 * `./parse5-region-parser.ts` for the implementation and its CIC-2 findings.
 */
export { createParse5RegionParser, isValidRegionHandle } from "./parse5-region-parser.js";
