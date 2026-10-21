import type { EmailAddress } from "./types.js";

/**
 * @file The one place a system email's `From` is decided. Each caller passes its own `*.local`
 * placeholder as the fallback; the placeholder is only ever used by a mailer that sends nothing,
 * because real providers (hosted APIs, SMTP relays) reject a `.local` sender outright.
 *
 * Order: the site's configured sender wins whatever the mailer is. With no configured sender, a
 * non-delivering mailer (Console, in-memory) keeps the placeholder, so local development still
 * works with zero setup. A delivering mailer with no configured sender throws
 * {@link SenderIdentityNotConfiguredError} instead of handing the provider a From it will refuse.
 * Hosts supply the settings read, the boot-time settle and the operator-facing error copy.
 */

/** Drivers that never hand a message to a real provider, so a `.local` From cannot be rejected.
 *  `console` prints to stdout; `memory` is the in-process fake. Every other driver is treated as
 *  delivering: an unknown driver fails closed. */
export const NON_DELIVERING_MAIL_DRIVERS: ReadonlySet<string> = new Set(["console", "memory"]);

/** Thrown when a delivering mailer is active but the site has no sender address configured. */
export class SenderIdentityNotConfiguredError extends Error {
  readonly code = "mail_sender_not_configured";

  /** @param optional.message host copy naming where the sender is configured. */
  constructor(required: { workspaceId: string; driver: string }, optional: { message?: string } = {}) {
    super(optional.message ?? `No sender address is configured for workspace ${required.workspaceId}, so the "${required.driver}" mailer ` +
      `cannot send: real mail providers reject the placeholder no-reply@*.local sender. Configure a sender address the provider accepts.`);
    this.name = "SenderIdentityNotConfiguredError";
  }
}

/** The site's saved sender, either part possibly absent. */
export interface ConfiguredMailSender {
  email?: string;
  name?: string;
}

/** Resolves the `From` for one system email. */
export interface MailSenderIdentityPort {
  /**
   * @param required.fallback The caller's placeholder sender; its `name` also fills in a missing
   *   configured display name.
   * @throws SenderIdentityNotConfiguredError See this file's header.
   */
  resolve(required: { workspaceId: string; fallback: EmailAddress }, optional?: Record<string, never>): Promise<EmailAddress>;
}

export interface CreateMailSenderIdentityResolverOptional {
  /** Reads the site's saved sender. Absent: nothing is configured (hermetic test roots). */
  readConfiguredSender?: (required: { workspaceId: string }) => Promise<ConfiguredMailSender | null>;
  /** Waits for the host's boot-time mailer swap. Without it, a read in the first moments after boot,
   *  or right after a key is saved, can still see the Console fallback and pick the placeholder for
   *  a send that then reaches the real provider. */
  settle?: () => Promise<void>;
  /** Builds the refusal; default {@link SenderIdentityNotConfiguredError} with neutral copy. */
  notConfigured?: (required: { workspaceId: string; driver: string }) => Error;
}

/** An address with its display name only when there is one (exact optional `name`). */
function withName(email: string, name: string | undefined): EmailAddress {
  return name === undefined ? { email } : { email, name };
}

/**
 * Builds the resolver over the active mailer's driver. See this file's header for the decision order.
 * @param required.readDriver the active mailer's driver, read after `settle`.
 * @complexity One settle, at most one settings read, one driver read.
 */
export function createMailSenderIdentityResolver(
  required: { readDriver: () => string },
  optional: CreateMailSenderIdentityResolverOptional = {}
): MailSenderIdentityPort {
  const { notConfigured = (details: { workspaceId: string; driver: string }) => new SenderIdentityNotConfiguredError(details) } = optional;
  return {
    resolve: async ({ workspaceId, fallback }) => {
      const configured = await optional.readConfiguredSender?.({ workspaceId });
      if (configured?.email) return withName(configured.email, configured.name ?? fallback.name);
      await optional.settle?.();
      const driver = required.readDriver();
      if (NON_DELIVERING_MAIL_DRIVERS.has(driver)) return fallback;
      throw notConfigured({ workspaceId, driver });
    },
  };
}
