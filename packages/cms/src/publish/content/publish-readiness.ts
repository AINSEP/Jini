/**
 * @file "Is publishing set up for this site?", answered in sentences a person who has never heard
 * the word *key* can read.
 *
 * ## Why this is a pure function with no I/O
 *
 * Multiple callers want the same answer and must not each invent their own wording: the assistant's
 * `publish_content_status` tool, and the Publish dialog's own empty state.
 * Every input below is a fact one repo read or one table read already produces, so keeping the
 * decision pure means the wording is directly assertable — including the property that matters most
 * here, which is that no string it can produce teaches a concept. The sentences are the host's
 * (see Wiring); the vocabulary rule below binds the copy the host supplies.
 *
 * ## The vocabulary rule, stated as a rule
 *
 * Nothing in this file may name a key, a token, a grant, a principal, a capability, a workspace id,
 * an installation id, a generation, a peer, or a bundle. Not because those are secret — most are in
 * committed config — but because naming them is the vocabulary lesson the whole zero-setup design
 * exists to avoid (`features/publish-trust/connect.ts`'s header; the owner rejected the key ceremony
 * five times). The host's publish agent-tools test asserts it over every reachable sentence rather
 * than trusting review, mirroring `publish-trust/__tests__/provisioning.test.ts`'s identical guard.
 *
 * ## "Never connected" is an empty state, not a fault
 *
 * A fresh install that has never been deployed has nowhere to publish to. That is the ordinary first
 * run. It gets a plain sentence and a next step, never an error and never a code.
 *
 * ## Wiring
 *
 * The host supplies every sentence on `PublishReadinessInput.copy` (`PublishReadinessCopy`): its
 * one-click publishing vocabulary and onboarding instructions are product copy. This module owns
 * only the decision — check order, verdict and `ready` flag — and the host label for an address.
 */

/**
 * The four situations a source install can be in. Deliberately coarse: a person does not need four
 * shades of "not set up", they need to know whether it works and what to do if it does not.
 */
export type PublishReadinessVerdict =
  /** Something on this computer can publish somewhere right now. */
  | "ready"
  /** There is a live site to publish to, but this computer has not been connected to it. */
  | "not-connected"
  /** This site has never been deployed, so there is no live site to publish to. */
  | "no-live-site"
  /** Nothing on this site is registered as publishable, so connecting would grant nothing. */
  | "nothing-publishable";

/** Every fact the verdict depends on, each one already produced by a single existing read. */
export interface PublishReadinessInput {
  /** The site this computer was connected to, as a person recognises it. `null` when there is none. */
  readonly connectedSiteLabel: string | null;
  /** Sites this computer was given a way to publish to by hand, before the one-click connect existed. */
  readonly otherSiteLabels: readonly string[];
  /** The address read out of the repo's own deploy config — what to offer when nothing is connected. */
  readonly candidateUrl: string | null;
  /** How many kinds of thing on this site are registered as publishable. Zero means a connection
   *  would be able to publish nothing at all, which is worth saying before it is made. */
  readonly publishableTypeCount: number;
  /** The host's sentences for each verdict. This module decides; it authors no wording. */
  readonly copy: PublishReadinessCopy;
}

/** Three sentences for a verdict that is not ready. */
export interface PublishReadinessSentences {
  readonly summary: string;
  readonly missing: string;
  readonly nextStep: string;
}

/** Host-owned wording for every verdict (feature-owned port; the host supplies product vocabulary). */
export interface PublishReadinessCopy {
  readonly nothingPublishable: PublishReadinessSentences;
  /** The ready summary for the connected site, or for every hand-configured site in order. */
  readonly publishesTo: (input: { siteLabels: readonly string[] }) => string;
  /** The not-connected sentences, given the candidate's host label. */
  readonly notConnected: (input: { siteLabel: string }) => PublishReadinessSentences;
  readonly noLiveSite: PublishReadinessSentences;
}

/** The answer, as strings to show and one flag to branch on. */
export interface PublishReadiness {
  /** `true` when a publish attempted right now would have somewhere to go. */
  readonly ready: boolean;
  readonly verdict: PublishReadinessVerdict;
  /** One sentence describing where things stand. Always present. */
  readonly summary: string;
  /** One sentence naming what is missing, or `null` when nothing is. */
  readonly missing: string | null;
  /** One sentence naming what happens next, or `null` when nothing is pending. */
  readonly nextStep: string | null;
}

/**
 * The site's host, as the name a person recognises rather than the address.
 *
 * Falls back to the raw string rather than throwing: this is a label for a sentence, and a sentence
 * naming an odd-looking address is more use than an exception.
 *
 * @complexity O(n) in the URL's length.
 */
export function siteLabelFor({ baseUrl }: { baseUrl: string }, _optional = {}): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * Decides whether this computer can publish. Every sentence comes from the host's `copy`.
 *
 * Check order is load-bearing and not alphabetical: "nothing here is publishable" is checked FIRST
 * because it blocks both connecting and publishing, so reporting "ready" on an install whose
 * connection could carry nothing would be true about the connection and false about the person's
 * actual question. After that, either route to a live site counts as ready — the one-click
 * connection and a hand-configured destination are different plumbing for the same capability, and
 * a person who has one does not need to hear about the other.
 *
 * @returns A verdict plus up to three sentences. `summary` is always present; `missing` and
 * `nextStep` are `null` exactly when there is nothing to say.
 * @complexity O(n) in `otherSiteLabels`.
 */
export function describePublishReadiness(input: PublishReadinessInput, _optional = {}): PublishReadiness {
  const { copy } = input;
  if (input.publishableTypeCount === 0) return { ready: false, verdict: "nothing-publishable", ...copy.nothingPublishable };
  const siteLabels = input.connectedSiteLabel !== null ? [input.connectedSiteLabel] : input.otherSiteLabels;
  if (siteLabels.length > 0) return { ready: true, verdict: "ready", summary: copy.publishesTo({ siteLabels }), missing: null, nextStep: null };
  if (input.candidateUrl !== null) {
    return { ready: false, verdict: "not-connected", ...copy.notConnected({ siteLabel: siteLabelFor({ baseUrl: input.candidateUrl }) }) };
  }
  // The never-deployed install. An ordinary first run, so: no fault, no code, no vocabulary.
  return { ready: false, verdict: "no-live-site", ...copy.noLiveSite };
}
