import { describe, expect, it } from "vitest";

import { SPACE_HOLD_TO_TALK_MS } from "../space-hold-config.js";

describe("SPACE_HOLD_TO_TALK_MS", () => {
  it("engages in a few hundred ms, not seconds", () => {
    // The owner originally asked for a 4-second hold. Four seconds before every utterance is far
    // slower than push-to-talk anywhere else, and the emptiness gate (not a long wait) is what
    // makes the gesture safe. Asserted so a future retune stays in the intended band rather than
    // silently drifting back.
    expect(SPACE_HOLD_TO_TALK_MS).toBeGreaterThanOrEqual(300);
    expect(SPACE_HOLD_TO_TALK_MS).toBeLessThanOrEqual(700);
  });
});
