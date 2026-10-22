/**
 * @file ADR-031 §5 — the local heuristic `SpamCheckPort` adapter (ADR-006 rule-of-two "built
 * now" half; an external service adapter remains a plausible second adapter).
 * No network I/O.
 *
 * Signals, combined into a `[0,1]` score:
 * - link density in the body (a common comment-spam signal — many URLs per short body);
 * - a small keyword list of common spam phrases;
 * - an implausibly long body (wall-of-text link farms);
 * - an implausibly short body with a link (drive-by link drops).
 */
import { countLinks } from "./sanitize.js";
import type { SpamCheckPort } from "./ports.js";
import type { CommentSubmission, SpamVerdict } from "./types.js";

const SPAM_KEYWORDS = [
  "viagra",
  "cialis",
  "casino",
  "crypto giveaway",
  "make money fast",
  "click here now",
  "weight loss miracle",
  "bit.ly",
];

const LONG_BODY_THRESHOLD = 4000;
const SHORT_BODY_WITH_LINK_THRESHOLD = 40;

function keywordHits(bodyLower: string): number {
  return SPAM_KEYWORDS.reduce((count, kw) => (bodyLower.includes(kw) ? count + 1 : count), 0);
}

export class HeuristicSpamCheck implements SpamCheckPort {
  async check(submission: CommentSubmission, _optional: Record<string, never> = {}): Promise<SpamVerdict> {
    const body = submission.bodyRaw;
    const bodyLower = body.toLowerCase();
    const links = countLinks({ text: body }, {});
    const keywords = keywordHits(bodyLower);

    let score = 0;
    // Link density: each link past the first adds risk; heavily link-laden bodies are the
    // single strongest comment-spam signal.
    score += Math.min(0.6, Math.max(0, links - 1) * 0.2);
    // Any spam keyword is a strong, near-conclusive signal.
    score += Math.min(0.7, keywords * 0.35);
    // A short body that still carries a link reads as a drive-by drop.
    if (body.length < SHORT_BODY_WITH_LINK_THRESHOLD && links > 0) score += 0.3;
    // An implausibly long body padded with links/keywords.
    if (body.length > LONG_BODY_THRESHOLD && (links > 0 || keywords > 0)) score += 0.2;

    score = Math.min(1, score);

    return { isSpam: score >= 0.5, score, provider: "heuristic" };
  }

  /** No feedback loop to update locally — this adapter has no model to correct. */
  async report(): Promise<void> {
    // no-op — documented in ports.ts as the local adapter's expected behavior.
  }
}
