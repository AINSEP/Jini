import type { Translate } from "@jini-ai/ui/panel-kit";

/** A non-empty `Error.message`, or `undefined` for anything else — the "raw server text" both
 *  branches of {@link describeIdentityError} prefer over a translated default. */
function errorMessage(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined;
}

/** The string `code` an Error or plain object carries, or `undefined` when there is none. */
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** Error codes are data, so any host transport can supply them without a shared error class. */
export function describeIdentityError(
  { error, fallback, translate }: { error: unknown; fallback: string; translate: Translate },
  { messages = {} }: { messages?: Readonly<Record<string, string>> } = {},
): string {
  const code = errorCode(error);
  if (code === "VALIDATION_ERROR") return errorMessage(error) ?? translate("Please correct the highlighted fields.");
  const message = code === undefined ? undefined : messages[code];
  if (message) return translate(message);
  return errorMessage(error) ?? fallback;
}
