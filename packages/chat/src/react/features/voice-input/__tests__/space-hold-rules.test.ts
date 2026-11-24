import { describe, expect, it } from "vitest";

import {
  resolveSpaceHoldKeyDown,
  resolveSpaceHoldKeyUp,
  type SpaceHoldKeyDownInput,
} from "../space-hold-rules.js";

const SPACE_KEY = " ";

/**
 * @file Direct assertions on the hold-space gesture's decision table. The DOM wiring that consumes
 * it is exercised separately against a real `ChatPane` in
 * `__tests__/voice-to-composer.integration.test.tsx`; everything here is pure.
 */

function keyDown(overrides: Partial<SpaceHoldKeyDownInput> = {}): SpaceHoldKeyDownInput {
  return { key: SPACE_KEY, holdKey: SPACE_KEY, isComposing: false, phase: "released", draft: "", ...overrides };
}

describe("resolveSpaceHoldKeyDown", () => {
  it("arms on the first space in an empty draft", () => {
    expect(resolveSpaceHoldKeyDown(keyDown())).toBe("arm");
  });

  it("treats a whitespace-only draft as empty — there is nothing there to corrupt", () => {
    expect(resolveSpaceHoldKeyDown(keyDown({ draft: "  \n " }))).toBe("arm");
  });

  it("ignores the keystroke entirely once the draft has real text", () => {
    // The single most important negative case: with text in the box, space is just a space.
    expect(resolveSpaceHoldKeyDown(keyDown({ draft: "half a sentence" }))).toBe("ignore");
  });

  it("honours whichever key the host binds", () => {
    expect(resolveSpaceHoldKeyDown(keyDown({ key: "a", holdKey: "a" }))).toBe("arm");
    expect(resolveSpaceHoldKeyDown(keyDown({ key: " ", holdKey: "a" }))).toBe("ignore");
  });

  it("ignores every key that is not the bound key", () => {
    expect(resolveSpaceHoldKeyDown(keyDown({ key: "a" }))).toBe("ignore");
    expect(resolveSpaceHoldKeyDown(keyDown({ key: "Enter" }))).toBe("ignore");
  });

  it("ignores space mid-IME-composition, where it commits a candidate", () => {
    expect(resolveSpaceHoldKeyDown(keyDown({ isComposing: true }))).toBe("ignore");
  });

  it("suppresses the repeats that arrive while armed or recording", () => {
    // This is the run-of-spaces failure mode the gesture would otherwise have.
    expect(resolveSpaceHoldKeyDown(keyDown({ phase: "armed" }))).toBe("suppress");
    expect(resolveSpaceHoldKeyDown(keyDown({ phase: "engaged" }))).toBe("suppress");
  });

  it("suppresses a repeat even after the operator's draft changed mid-hold", () => {
    // Phase wins over emptiness here: once a hold is in flight, no space keystroke belonging to it
    // may reach the textarea, whatever the draft has become in the meantime.
    expect(resolveSpaceHoldKeyDown(keyDown({ phase: "engaged", draft: "typed while holding" }))).toBe("suppress");
  });
});

describe("resolveSpaceHoldKeyUp", () => {
  it("releases a hold that had already opened the mic", () => {
    expect(resolveSpaceHoldKeyUp({ key: SPACE_KEY, holdKey: SPACE_KEY, phase: "engaged" })).toBe("release");
  });

  it("disarms a hold released before the threshold — a quick tap", () => {
    expect(resolveSpaceHoldKeyUp({ key: SPACE_KEY, holdKey: SPACE_KEY, phase: "armed" })).toBe("disarm");
  });

  it("ignores a keyup with no gesture in flight", () => {
    expect(resolveSpaceHoldKeyUp({ key: SPACE_KEY, holdKey: SPACE_KEY, phase: "released" })).toBe("ignore");
  });

  it("ignores a keyup for any other key, even mid-hold", () => {
    expect(resolveSpaceHoldKeyUp({ key: "a", holdKey: SPACE_KEY, phase: "engaged" })).toBe("ignore");
  });
});
