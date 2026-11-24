import type { PublishPorts } from "@jini-ai/core/contracts/site/publish-ports";
import type { BeforeSaveHookPort } from "../../posts/post-before-save.js";
import type { PostPublishPorts } from "../../posts/post-publish-ports.js";
import type { MediaPublishPorts } from "../../media/publish-ports.js";
import type { RedirectPublishPorts } from "../../redirects/publish-ports.js";
import type { MenuPublishPorts } from "../../navigation/publish-ports.js";
import type { FormPublishPorts } from "../../forms/publish-ports.js";
import type { ContentTypePublishPorts } from "../../content-types/publish-ports.js";
import type { TaxonomyPublishPorts } from "../../taxonomy/publish-ports.js";
import type { EntryPublishPorts } from "../../entries/publish-ports.js";
import type { WidgetPublishPorts } from "../../widgets/publish-ports.js";
import type { SettingPublishPorts } from "../../settings/publish-ports.js";

/**
 * @file The port bag of every publishable type this package owns, keyed by `entityType`
 * (`PublishPorts`, `@jini-ai/core/contracts/site/publish-ports`, explains why one typed bag).
 *
 * Each feature owns its slice type next to its own code; this file only names which `entityType`
 * key carries which slice. A host composes the bag with its own host-only slices by intersection
 * (`CmsPublishPorts & { "theme-files": …; "active-theme": … }`).
 *
 * Factory-built types below share a handler factory in the host, so a new key here is one edit in the
 * host's single bag builder.
 */
export type CmsPublishPorts = PublishPorts<{
  post: PostPublishPorts;
  media: MediaPublishPorts;
  redirect: RedirectPublishPorts;
  menu: MenuPublishPorts;
  form: FormPublishPorts;
  "content-type": ContentTypePublishPorts;
  taxonomy: TaxonomyPublishPorts;
  term: TaxonomyPublishPorts;
  "collection-entry": EntryPublishPorts;
  widget: WidgetPublishPorts;
  "widget-area": WidgetPublishPorts;
  "site-setting": SettingPublishPorts;
}> & {
  /**
   * Host hooks a handler may run. Not an entity type: the engine never reads this field, one
   * handler does (the post handler's apply). It lives in the bag, and not on the engine's deps,
   * because the hook's contract (`BeforeSaveHookPort`) belongs to the post feature. Absent behaves
   * exactly like `CreatePostDeps.beforeSaveHook` absent: no plugin `ext` patch is applied and no
   * plugin can refuse the write. See `post.ts`'s own docs.
   */
  readonly hooks?: { readonly beforeSave?: BeforeSaveHookPort };
};
