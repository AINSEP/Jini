import type { EntryListExcludingTypesPort } from "../widgets/resolvers/ports.js";
import type { ContentTypeRepoPort } from "../content-types/write-service.js";
import type { TaxonomyPublishPorts } from "../taxonomy/publish-ports.js";
import type { EntryPublishReadPort } from "./publish-read-port.js";
import type { EntryRepoPort } from "./write-service.js";

/** @file The `collection-entry` slice of a publish bag (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`).
 *
 * `collection-entry`'s bag: the entry repo (trash-inclusive read), the owning-type lookup and the term bag. */
export interface EntryPublishPorts {
  readonly entries: EntryRepoPort & EntryListExcludingTypesPort & EntryPublishReadPort;
  readonly contentTypes: ContentTypeRepoPort;
  /** An entry's categories/tags (`termIds`) read and sync through the taxonomy bag. */
  readonly terms: TaxonomyPublishPorts;
}
