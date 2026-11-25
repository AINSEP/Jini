import type { PagesHtmlDocumentStoreFactory } from "../page-html-store.js";

const factory: PagesHtmlDocumentStoreFactory = (scope) => ({
  ensureHtmlFormat: async () => {},
  read: async () => scope.postId,
  write: async () => {},
  capturedVersion: () => null,
});

const store = factory({ workspaceId: "workspace", postId: "page" });
const capturedVersion: number | null = store.capturedVersion();
void capturedVersion;

// @ts-expect-error A store must be scoped to a workspace as well as a page.
factory({ postId: "page" });

// @ts-expect-error A factory result must expose the read/write CAS basis.
const missingCapturedVersion: PagesHtmlDocumentStoreFactory = () => ({ ensureHtmlFormat: async () => {}, read: async () => "", write: async () => {} });
void missingCapturedVersion;
