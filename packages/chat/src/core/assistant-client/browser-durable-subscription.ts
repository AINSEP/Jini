import type { ChatMessage } from "../messages.js";
import type { DurableSubscriptionPorts } from "./durable-run-subscription.js";
import { querySuffix } from "@jini-ai/core/admin-runtime";

/** Map the existing recovery/checkpoint routes to one fetch. Conditional headers apply only to
 * routine polls; explicit recovery must always reach the finalizer. No response body is read here.
 */
function requestDurableProjection({ request, runPath, runId, messageId, recover, etag }: {
  request: typeof fetch; runPath: (required: { runId: string }, optional?: Record<string, never>) => string; runId: string; messageId?: string | undefined; recover: boolean; etag?: string | null | undefined;
}, _options = {}): Promise<Response> {
  const path = runPath({ runId }, {});
  if (recover) return request(`${path}/recover`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId }),
  });
  const query = messageId ? 'messageId=' + encodeURIComponent(messageId) : '';
  return request(`${path}/checkpoint${querySuffix({ query })}`, {
    method: 'GET', credentials: 'same-origin', ...(etag ? { headers: { 'If-None-Match': etag } } : {}),
  });
}

/** Status-only outcomes do not advance the projection checkpoint. */
function durableReadRefusal(response: Response): null | "gone" | undefined {
  if (response.status === 304) return null;
  if (response.status === 404) return "gone";
  if (!response.ok) return null;
  return undefined;
}

/** Browser adapters only: active run streams are never visibility-paused. Ports permit DI fakes
 * without replacing modules; native disconnects retain Jini's existing recovery/backoff behavior.
 */
export function browserDurableSubscriptionPorts({ request, open, schedule, runPath }: {
  request: typeof fetch;
  open: (url: string) => Pick<EventSource, "addEventListener" | "close" | "readyState">;
  schedule: (required: { work: () => void; delayMs: number }) => () => void;
  runPath: (required: { runId: string }, optional?: Record<string, never>) => string;
}, _optional: Record<string, never> = {}): DurableSubscriptionPorts {
  let checkpointKey: string | undefined;
  let checkpointEtag: string | null | undefined;
  return {
    async read({ runId, messageId }, { recover = true }: { recover?: boolean } = {}) {
      const key = messageId ?? runId;
      const etag = checkpointKey === key ? checkpointEtag : undefined;
      const response = await requestDurableProjection({ request, runPath, runId, messageId, recover, etag });
      if (recover) { checkpointKey = undefined; checkpointEtag = undefined; }
      const refused = durableReadRefusal(response);
      if (refused !== undefined) return refused;
      if (!recover) { checkpointKey = key; checkpointEtag = response.headers.get('ETag'); }
      const payload = await response.json() as { message: ChatMessage };
      return payload.message;
    },
    stream({ runId, cursor, frame, dropped }, _options) {
      const source = open(`${runPath({ runId }, {})}/events${querySuffix({ query: cursor ? "afterCursor=" + encodeURIComponent(cursor) : "" })}`);
      for (const kind of ["agent", "stdout", "stderr", "end", "error"]) {
        source.addEventListener(kind, (event) => {
          const message = event as MessageEvent<string>;
          if (kind === "error" && !message.data) { source.close(); dropped(); return; }
          frame(kind, message.data, message.lastEventId);
        });
      }
      return () => source.close();
    },
    schedule(required, _options) { return schedule(required); },
  };
}
