/**
 * @file `MembersWriteService` implementation (ADR-030 §3/§6, plus the member sign-in amendment).
 *
 * The single write chokepoint for member-domain mutations: email sign-in (link + code), profile
 * updates, disable-only lifecycle and comp/subscription changes, plus the host adapters for
 * Jini's shared email-challenge primitives. Plain async functions taking `{ deps, input }`.
 *
 * New-address challenges reserve a member id and carry the email, without creating a member or
 * principal. Consumption resolves that email again and creates the member then. Legacy
 * challenges without an email remain bound to their existing member id.
 */
import type { MembersWriteService } from "./ports.js";
import { requestSignInLink } from "./member-challenge-request.js";
import { completeSignIn } from "./member-sign-in.js";
import { updateProfile, disableMember, compSubscription, setSubscriptionStatus } from "./member-admin-writes.js";

/**
 * The `MembersWriteService` implementation, grouped into the port shape.
 */
export const membersWriteService: MembersWriteService = {
  requestSignInLink,
  completeSignIn,
  updateProfile,
  disableMember,
  compSubscription,
  setSubscriptionStatus,
};
