import { useCallback, useMemo, useState } from "react";

import type { EmailApi, MailTestSendResult, MailUseRow } from "../email-api.types.js";
import { errorMessage, useLoad, type LoadView, type EmailLoadApiError } from "./email-load.hooks.js";

/**
 * @file Overview tab state beyond the status read: **What uses email** (`GET …/mail-uses`) and
 * **Send test email** (`POST …/mail-test-send`). The click is the confirmation; one request id per
 * click makes a retried request replay instead of sending twice. A blank recipient means the
 * signed-in operator's own address (the server's default).
 */

export type TestSendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; result: MailTestSendResult }
  | { kind: "error"; message: string };

export interface EmailOverviewController {
  uses: LoadView<{ checkedAt: string; uses: MailUseRow[] }>;
  reloadUses: () => void;
  to: string;
  setTo: (value: string) => void;
  test: TestSendState;
  sendTest: () => Promise<void>;
}

/** The host's transport error class: `status` and `message`, plus the parsed error `body` a 429 carries. */
export type EmailOverviewApiError = abstract new (...args: never[]) => Error & { readonly status: number; readonly body?: Record<string, unknown> };

/**
 * @param required.api - the Email API port; a fake in tests.
 * @param required.ApiError - the host's transport error class.
 * @param required.requestId - the id factory (one idempotency key per click); fixed in tests.
 */
export function useEmailOverview(required: { api: Pick<EmailApi, "readUses" | "sendTest">; ApiError: EmailOverviewApiError; requestId: () => string }, _optional = {}): EmailOverviewController {
  const { api, ApiError } = required;
  const makeId = required.requestId;
  const load = useCallback(() => api.readUses(), [api]);
  const { view: uses, reload: reloadUses } = useLoad({ ApiError, load });
  const [to, setTo] = useState("");
  const [test, setTest] = useState<TestSendState>({ kind: "idle" });

  const sendTest = useCallback(async () => {
    setTest({ kind: "sending" });
    try {
      const answer = await api.sendTest({ to: to.trim() || undefined, requestId: makeId() });
      setTest({ kind: "done", result: answer.result });
      reloadUses();
    } catch (error) {
      // 429 still carries the truthful result (duplicate or rate limited): show it, not a bare error.
      const result = error instanceof ApiError ? (error.body?.result as MailTestSendResult | undefined) : undefined;
      setTest(result ? { kind: "done", result } : { kind: "error", message: errorMessage({ error, ApiError }) });
    }
  }, [api, to, makeId, reloadUses]);

  return useMemo(() => ({ uses, reloadUses, to, setTo, test, sendTest }), [uses, reloadUses, to, test, sendTest]);
}

