import type { JsonValue } from "@jini-ai/core/primitives";
import type { ResolveHtmlPageEmbedsResult } from "../../../../widgets/html/index.js";
import type { DocRenderOptions } from "./doc/doc-render-contract.js";

export interface BodyRenderPorts {
  renderHtmlPageBody: (required: { html: string; resolved: ResolveHtmlPageEmbedsResult | undefined }) => string;
  renderDocNode: (required: { node: JsonValue }, options?: DocRenderOptions) => string;
}
