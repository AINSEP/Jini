import type { AdminMailStatus } from "./mail-status-api.types.js";

/** What the host injects into {@link createMailStatusApi}. */
export interface MailStatusApiDeps {
  /** The host's `request`: it owns the base URL, authentication, retries and error decoding, so this client only names paths, methods and bodies. */
  request: <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;
  /** The workspace the paths are scoped under (`/workspaces/<id>/...`). */
  workspaceId: string;
}

/** The admin API calls of the mail-status feature, bound to the host's injected collaborators.
 *  @example const mailStatusApi = createMailStatusApi({ request, workspaceId }); */
export function createMailStatusApi({ request, workspaceId }: MailStatusApiDeps, _optional: Record<string, never> = {}) {
  return {
    /** Whether outbound email really sends — the form editor greys out its notify settings when not. */
    getMailStatus: () => request<AdminMailStatus>({ path: `/workspaces/${workspaceId}/system/mail-status` }),
  };
}
