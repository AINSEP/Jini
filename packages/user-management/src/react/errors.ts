import type { Translate } from "@jini-ai/ui/panel-kit";

/** Error codes are data, so any host transport can supply them without a shared error class. */
export function describeIdentityError(
  { error, fallback, translate }: { error: unknown; fallback: string; translate: Translate },
  { messages = {} }: { messages?: Readonly<Record<string, string>> } = {},
): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    if (error.code === "VALIDATION_ERROR") {
      return error instanceof Error && error.message ? error.message : translate("Please correct the highlighted fields.");
    }
    const message = messages[error.code];
    if (message) return translate(message);
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
