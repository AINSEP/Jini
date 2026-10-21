/**
 * @file Inbound delivery feedback (bounces, complaints) — one ingest, one suppression writer.
 *
 * The host mounts this behind `POST /hooks/mail/:providerId` with the RAW body. Hardening lives
 * here so every host gets it: a body-size cap before parsing, a rate limit on unverified requests
 * (signature guessing), vault-held secrets with rotation (any of several may verify), and an inbox
 * keyed by (providerId, eventId) so provider replays are no-ops.
 */
import type { MailFeedbackParser } from "./provider.js";
import type { MailSuppressionRepoPort, MailSuppressionScope } from "./ports.js";
import type { MailerFeedbackEvent } from "./types.js";

export interface MailFeedbackInboxPort {
  /** Insert-if-absent on (providerId, eventId); `duplicate` means this event was already applied. */
  record(required: { providerId: string; event: MailerFeedbackEvent & { eventId: string; recipient: string } }): Promise<"inserted" | "duplicate">;
}

export interface MailFeedbackIngestDeps {
  /** Only providers whose module ships a parser; others 404 so the route reveals nothing else. */
  parserFor: (required: { providerId: string }) => MailFeedbackParser | undefined;
  /** Current + previous webhook secrets from the vault; empty = not configured. */
  secretsFor: (required: { providerId: string }) => Promise<readonly string[]>;
  inbox: MailFeedbackInboxPort;
  suppression: MailSuppressionRepoPort;
}

export interface MailFeedbackIngestOptions {
  maxBodyBytes?: number;
  /** Unverified requests allowed per provider per window before 429. */
  maxUnverifiedPerWindow?: number;
  windowMs?: number;
  now?: () => number;
  /** Extra subscriber after suppression (e.g. newsletter recipient status). Errors propagate. */
  onEvent?: (required: { providerId: string; event: MailerFeedbackEvent }) => Promise<void>;
}

export interface MailFeedbackResponse {
  status: 200 | 400 | 401 | 404 | 413 | 429 | 503;
  body: { ok: boolean; applied?: number; duplicates?: number; error?: string };
}

/** Hard bounce → every lane; complaint → bulk only (never lock a member out of sign-in links). */
export function suppressionScopeFor({ event }: { event: MailerFeedbackEvent }): MailSuppressionScope | null {
  if (event.kind === "bounced") return event.hardBounce ? "all" : null;
  if (event.kind === "complained") return "bulk";
  return null;
}

type KeyedEvent = MailerFeedbackEvent & { eventId: string; recipient: string };

function isKeyed(event: MailerFeedbackEvent): event is KeyedEvent {
  return typeof event.eventId === "string" && event.eventId !== "" && typeof event.recipient === "string" && event.recipient !== "";
}

function createUnverifiedCounter(required: { max: number; windowMs: number; now: () => number }) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    blocked({ providerId }: { providerId: string }): boolean {
      const entry = windows.get(providerId);
      return entry !== undefined && required.now() - entry.start < required.windowMs && entry.count >= required.max;
    },
    note({ providerId }: { providerId: string }): void {
      const at = required.now();
      const entry = windows.get(providerId);
      if (entry === undefined || at - entry.start >= required.windowMs) windows.set(providerId, { start: at, count: 1 });
      else entry.count += 1;
    },
  };
}

/**
 * @complexity O(events) inbox writes per request.
 * @example createMailFeedbackIngest({ parserFor, secretsFor, inbox, suppression }).handle({...})
 */
export function createMailFeedbackIngest(required: MailFeedbackIngestDeps, optional: MailFeedbackIngestOptions = {}) {
  const now = optional.now ?? Date.now;
  const maxBodyBytes = optional.maxBodyBytes ?? 256 * 1024;
  const unverified = createUnverifiedCounter({ max: optional.maxUnverifiedPerWindow ?? 30, windowMs: optional.windowMs ?? 60_000, now });

  const apply = async (input: { providerId: string; event: KeyedEvent }): Promise<"inserted" | "duplicate"> => {
    const outcome = await required.inbox.record(input);
    if (outcome === "duplicate") return outcome;
    const scope = suppressionScopeFor({ event: input.event });
    if (scope !== null) {
      const reason = input.event.kind === "complained" ? "complained" : "bounced";
      await required.suppression.suppress({ workspaceId: input.event.workspaceId, normalizedAddress: input.event.recipient.trim().toLowerCase(), scope, reason });
    }
    await optional.onEvent?.(input);
    return outcome;
  };

  const authenticate = async (input: { providerId: string; parser: MailFeedbackParser; rawBody: Uint8Array; headers: Readonly<Record<string, string>> }): Promise<MailFeedbackResponse | null> => {
    const secrets = await required.secretsFor({ providerId: input.providerId });
    if (secrets.length === 0) return { status: 503, body: { ok: false, error: "webhook secret not configured" } };
    if (input.parser.verify({ rawBody: input.rawBody, headers: input.headers, secrets, now: now() })) return null;
    unverified.note({ providerId: input.providerId });
    return { status: 401, body: { ok: false, error: "signature rejected" } };
  };

  return {
    async handle(input: { providerId: string; workspaceId: string; rawBody: Uint8Array; headers: Readonly<Record<string, string>> }): Promise<MailFeedbackResponse> {
      const parser = required.parserFor({ providerId: input.providerId });
      if (!parser) return { status: 404, body: { ok: false, error: "unknown provider" } };
      if (input.rawBody.byteLength > maxBodyBytes) return { status: 413, body: { ok: false, error: "body too large" } };
      if (unverified.blocked({ providerId: input.providerId })) return { status: 429, body: { ok: false, error: "too many unverified requests" } };
      const denied = await authenticate({ ...input, parser });
      if (denied) return denied;
      const parsed = parser.parse({ rawBody: input.rawBody, workspaceId: input.workspaceId });
      if ("error" in parsed) return { status: 400, body: { ok: false, error: parsed.error } };
      let applied = 0;
      let duplicates = 0;
      // Events without an id or recipient cannot be deduped or suppressed; they are dropped, not guessed.
      for (const event of parsed.filter(isKeyed)) {
        if ((await apply({ providerId: input.providerId, event })) === "inserted") applied += 1;
        else duplicates += 1;
      }
      return { status: 200, body: { ok: true, applied, duplicates } };
    },
  };
}
