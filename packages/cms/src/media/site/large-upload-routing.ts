import type { ToolRegistration } from "@jini-ai/core";

const UPLOAD_TOOL_ID = "media_upload_asset";

/** Inline uploads need an alternate-path annotation for files that cannot be sent inline. */
export function withLargeUploadRouting({ registration, routingText }: { registration: ToolRegistration; routingText: string }, _optional: Record<string, never> = {}): ToolRegistration {
  if (registration.descriptor.id !== UPLOAD_TOOL_ID) return registration;
  const description = [registration.descriptor.description, routingText].filter(Boolean).join(" ");
  return { ...registration, descriptor: { ...registration.descriptor, description } };
}
