/**
 * @file `POST /hooks/mail/:providerId` — framework-free handler over Jini's `createMailFeedbackIngest`.
 *
 * Features never import Express (`features/INFO.md`); the server mounts {@link MailFeedbackRoute}
 * with a RAW body parser (signatures are over the exact bytes) ahead of the public JSON parser.
 * Hardening lives in the Jini ingest: body cap (413), unverified-request rate limit (429), unknown
 * provider (404), no secret configured (503), bad signature (401), replay dedup.
 */
import {
  createMailFeedbackIngest,
  type MailFeedbackInboxPort,
  type MailFeedbackIngestOptions,
  type MailFeedbackResponse,
} from "./feedback.js";
import type { MailFeedbackParser } from "./provider.js";
import type { MailSuppressionRepoPort } from "./ports.js";

/** Default body cap; the server's raw parser uses the same number so both refuse alike. */
export const MAIL_FEEDBACK_MAX_BODY_BYTES = 256 * 1024;

export interface MailFeedbackRouteDeps {
  /** The provider's feedback parser; undefined = unknown provider or no feedback support (404). May load plugins. */
  parserFor: (required: { providerId: string }) => MailFeedbackParser | undefined | Promise<MailFeedbackParser | undefined>;
  /** Current + previous webhook secrets from the vault; empty = not configured (503). */
  secretsFor: (required: { providerId: string }) => Promise<readonly string[]>;
  repos: { inbox: MailFeedbackInboxPort; suppression: MailSuppressionRepoPort };
  /** The workspace this site's mail belongs to. */
  resolveWorkspaceId: (required: Record<string, never>) => string | Promise<string>;
}

export interface MailFeedbackRequest {
  providerId: string;
  rawBody: Uint8Array;
  /** Node-style headers (lower-case keys; repeated headers as arrays). */
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface MailFeedbackRoute {
  readonly maxBodyBytes: number;
  handle(required: MailFeedbackRequest): Promise<MailFeedbackResponse>;
}

/** Flattens Node headers to the parser's `Record<string, string>`; lower-cased keys, arrays joined. */
export function flattenHeaders({ headers }: { headers: MailFeedbackRequest["headers"] }): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    flat[name.toLowerCase()] = typeof value === "string" ? value : value.join(", ");
  }
  return flat;
}

/**
 * One ingest per process, so the unverified-request counter is shared across requests.
 * @complexity O(events) inbox writes per request, plus one parser and one secrets lookup.
 * @example createMailFeedbackRoute({ parserFor, secretsFor, repos: { inbox, suppression }, resolveWorkspaceId })
 */
export function createMailFeedbackRoute(required: MailFeedbackRouteDeps, optional: MailFeedbackIngestOptions = {}): MailFeedbackRoute {
  const maxBodyBytes = optional.maxBodyBytes ?? MAIL_FEEDBACK_MAX_BODY_BYTES;
  // The Jini ingest asks for its parser synchronously; the lookup here may be async (plugin load),
  // so each request resolves first and the ingest reads the result in the same tick.
  const parsers = new Map<string, MailFeedbackParser>();
  const ingest = createMailFeedbackIngest(
    { parserFor: ({ providerId }) => parsers.get(providerId), secretsFor: required.secretsFor, inbox: required.repos.inbox, suppression: required.repos.suppression },
    { ...optional, maxBodyBytes },
  );
  return {
    maxBodyBytes,
    async handle({ providerId, rawBody, headers }) {
      const workspaceId = await required.resolveWorkspaceId({});
      const parser = await required.parserFor({ providerId });
      if (parser) parsers.set(providerId, parser);
      else parsers.delete(providerId);
      return ingest.handle({ providerId, workspaceId, rawBody, headers: flattenHeaders({ headers }) });
    },
  };
}
