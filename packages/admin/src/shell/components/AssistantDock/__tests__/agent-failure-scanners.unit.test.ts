import { expect, it } from "vitest";
import { redactCredentialShapes, redactSecretAssignments, stripControlCharacters, stripCsiSequences, stripOscSequences } from "../agent-failure-scanners.js";

it.each([
  ["BEL before ST", "a\u001b]title\u0007visible\u001b\\z", "avisible\u001b\\z"],
  ["ST before BEL", "a\u009dtitle\u001b\\visible\u0007z", "avisible\u0007z"],
  ["only ST", "a\u001b]title\u001b\\z", "az"],
  ["unterminated OSC", "a\u001b]incomplete", "a\u001b]incomplete"],
  ["not OSC", "a\u001b[31mz", "a\u001b[31mz"],
] as const)("removes terminal OSC through its first terminator: %s", (_label, text, expected) => {
  expect(stripOscSequences({ text })).toBe(expected);
});

it.each([
  ["final without parameters", "a\u001b[Az", "az"],
  ["8-bit introducer and private prefix", "a\u009b?25lz", "az"],
  ["multiple numeric groups", "a\u001b[38;5;196mz", "az"],
  ["empty parameter group", "a\u001b[38;;196mz", "az"],
  ["four-digit group limit", "a\u001b[123456mz", "a6mz"],
  ["trailing empty group with no final byte", "a\u001b[12;34;!z", "a;!z"],
  ["last digit with no final byte", "a\u001b[12!z", "a!z"],
  ["lone introducer", "a\u001b", "a\u001b"],
  ["invalid final byte", "a\u001b[Pz", "a\u001b[Pz"],
  ["literal final bytes", "a\u001b[=\u001b[Z\u001b[~z", "az"],
  ["last letter-range final byte", "a\u001b[uz", "az"],
] as const)("distinguishes CSI controls from printable text: %s", (_label, text, expected) => {
  expect(stripCsiSequences({ text })).toBe(expected);
});

it("removes C0 and C1 controls while preserving line endings, tabs, and Unicode text", () => {
  expect(stripControlCharacters({ text: "\u0000\u0008\tÉcran\r\n\u000b\u001f ~\u007f\u009f\u00a0🎉" }))
    .toBe("\tÉcran\r\n ~\u00a0🎉");
});

it("redacts provider-shaped words outside identifiers and resumes scanning through punctuation", () => {
  expect(redactCredentialShapes({ text: "xsk-fixture, sk-fixture; AIzaFixture end" }))
    .toBe("xsk-fixture, [REDACTED]; [REDACTED] end");
});

it("redacts named values through their delimiters without swallowing unrelated assignments", () => {
  expect(redactSecretAssignments({ text: 'region=west, "SERVICE_API KEY": "sample", token=opaque; password=; access-token = abc&mode=read' }))
    .toBe('region=west, "SERVICE_API KEY": "[REDACTED]", token=[REDACTED]; password=; access-token = [REDACTED]&mode=read');
});
