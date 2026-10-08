import { createEntry, updateEntry, importEntry, toEntryOutbox, VersionConflictError } from "../../../entries/index.js";
import { registerContentType, toContentTypeOutbox, NoopContentTypeIndexProvisioner, ContentTypeAlreadyExistsError } from "../../../content-types/index.js";
import type { EntryRefRow, EntryRefsRepoPort } from "../../ports.js";
import type { WidgetHostPorts } from "../../host-ports.js";

// Reuse the existing full-envelope CMS outbox fixture; widgets is not another outbox owner.
export { InMemoryOutbox } from "../../../redirects/__tests__/support/events.fixture.js";

/** Port bindings for tests of widget decisions, not tests of the host's extraction or slug policy. */
export const widgetHostFixture: Pick<WidgetHostPorts, "entries" | "contentTypes" | "entryRefs" | "slugify"> = {
  entries: {
    createEntry, updateEntry, importEntry, toEntryOutbox,
    isVersionConflict: (error) => error instanceof VersionConflictError,
  },
  contentTypes: {
    registerContentType, toContentTypeOutbox,
    createIndexProvisioner: () => new NoopContentTypeIndexProvisioner(),
    alreadyExists: (error) => error instanceof ContentTypeAlreadyExistsError ? { tombstoned: error.tombstoned } : null,
  },
  // Cases asserting the real host extractor stay in Tovu; this fixture deliberately emits no refs.
  entryRefs: { extract: () => [] },
  slugify: (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
};

/** Narrow reference-store fixture: records exactly the rows the supplied extraction port returns. */
export class InMemoryEntryRefsRepo implements EntryRefsRepoPort {
  private rows: EntryRefRow[] = [];
  async replaceForSource(required: Parameters<EntryRefsRepoPort["replaceForSource"]>[0]): Promise<void> {
    await this.removeBySource(required);
    this.rows.push(...required.refs);
  }
  async findBySource(required: Parameters<EntryRefsRepoPort["findBySource"]>[0]): Promise<EntryRefRow[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId && row.sourceEntryId === required.sourceEntryId);
  }
  async findByTarget(required: Parameters<EntryRefsRepoPort["findByTarget"]>[0]): Promise<EntryRefRow[]> {
    return this.rows.filter((row) => row.workspaceId === required.workspaceId && row.targetKind === required.targetKind && row.targetId === required.targetId);
  }
  async removeBySource(required: Parameters<EntryRefsRepoPort["removeBySource"]>[0]): Promise<void> {
    this.rows = this.rows.filter((row) => row.workspaceId !== required.workspaceId || row.sourceEntryId !== required.sourceEntryId);
  }
  async rebuildForWorkspace(required: Parameters<EntryRefsRepoPort["rebuildForWorkspace"]>[0]): Promise<void> {
    this.rows = this.rows.filter((row) => row.workspaceId !== required.workspaceId);
    this.rows.push(...required.refs);
  }
}
