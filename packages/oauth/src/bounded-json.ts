/** Internal JSON reader. Limits bytes mid-stream and cancels abandoned bodies, avoiding unbounded response buffering. */
import { afterSettled } from '@jini-ai/core/errors/idioms';
import { OAuthError } from "./errors.js";
export const MAX_OAUTH_RESPONSE_BYTES = 64 * 1024;
export interface BoundedJsonMessages {
    readonly overflowMessage: string;
    readonly overflowOperatorAction: string;
}
export async function readBoundedOAuthText({ response, messages }: { response: Response; messages: Pick<BoundedJsonMessages, "overflowMessage" | "overflowOperatorAction"> }, { maxBytes = MAX_OAUTH_RESPONSE_BYTES }: { maxBytes?: number | undefined } = {}): Promise<string> {
    const body = response.body;
    if (!body)
        return "";
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maxBytes) {
                throw new OAuthError({
                    code: "OAUTH_MALFORMED_RESPONSE", message: messages.overflowMessage,
                    operatorAction: messages.overflowOperatorAction
                });
            }
            chunks.push(Buffer.from(value));
        }
    }
    finally {
        // Cancel a still-open body after overflow so no further chunks are pulled. A cleanup
        // rejection must not mask the byte-cap or read failure that caused us to abandon it.
        await afterSettled({ promise: reader.cancel() });
    }
    return Buffer.concat(chunks).toString("utf8");
}
export function readStringArray({ value }: { value: unknown }, _optional: Record<string, never> = {}): readonly string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}
export function readOptionalString({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
