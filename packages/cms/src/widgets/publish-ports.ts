import type { ContentTypeRepoPort } from "../content-types/write-service.js";
import type { EntryPublishReadPort } from "../entries/publish-read-port.js";
import type { EntryListPort } from "../entries/list.js";
import type { EntryRepoPort } from "../entries/write-service.js";
import type { FormDefinitionRepoPort } from "../forms/ports.js";
import type { EntryRefsRepoPort, WidgetRegionBindingRepoPort } from "./ports.js";

/**
 * @file The `widget` and `widget-area` slices of a publish bag (`PublishPorts`,
 * `@jini-ai/core/contracts/site/publish-ports`) — one shared shape: the widgets write-service deps
 * minus the gateway fields.
 */
export interface WidgetPublishPorts {
  readonly entries: EntryRepoPort & EntryListPort & EntryPublishReadPort;
  readonly contentTypes: ContentTypeRepoPort;
  readonly entryRefs: EntryRefsRepoPort;
  readonly bindings: WidgetRegionBindingRepoPort;
  /** A `contact-form` widget names its form by id; the form travels by slug (`widgets/publish-content.ts`). */
  readonly forms: FormDefinitionRepoPort;
}
