/** Internal JSON reader. Limits bytes mid-stream and cancels abandoned bodies, avoiding unbounded response buffering. */
import { OAuthError } from "./errors.js";
export const MAX_OAUTH_RESPONSE_BYTES = 64 * 1024;
export interface BoundedJsonMessages {
    readonly overflowMessage: string;
    readonly overflowOperatorAction: string;
    readonly notJsonMessage: string;
    readonly notJsonOperatorAction: string;
}
export async function readBoundedOAuthText(response: Response, messages: Pick<BoundedJsonMessages, "overflowMessage" | "overflowOperatorAction">, maxBytes: number = MAX_OAUTH_RESPONSE_BYTES): Promise<string> {
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
        await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks).toString("utf8");
}
export function parseOAuthJsonObject(text: string, messages: Pick<BoundedJsonMessages, "notJsonMessage" | "notJsonOperatorAction">): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(text);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("not an object");
        return parsed as Record<string, unknown>;
    }
    catch (cause) {
        throw new OAuthError({
            code: "OAUTH_MALFORMED_RESPONSE", message: messages.notJsonMessage,
            operatorAction: messages.notJsonOperatorAction
        }, {
            cause
        });
    }
}
export async function readBoundedOAuthJson(response: Response, messages: BoundedJsonMessages, maxBytes: number = MAX_OAUTH_RESPONSE_BYTES): Promise<Record<string, unknown>> {
    return parseOAuthJsonObject(await readBoundedOAuthText(response, messages, maxBytes), messages);
}
export function readStringArray(value: unknown): readonly string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}
export function readOptionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
