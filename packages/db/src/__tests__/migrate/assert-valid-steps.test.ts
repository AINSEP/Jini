import { describe, expect, it } from "vitest";
import { assertValidSteps } from "../../migrate/runner.js";
import { MIGRATION_ID } from "../../migrate/step.js";

/** L2 §4 migrate/runner: id grammar anchors, strict ordering (duplicates included), and the
 *  checksum regex pinned at 63/64/65 hex chars, uppercase and prefixed junk. */
const sum = "a".repeat(64);
const step = (id: string, checksum = sum) => ({ id, checksum }) as never;

describe("MIGRATION_ID", () => {
  it.each(["0000_init", "0042_add_posts_2", "9999_x"])("accepts %j", (id) => expect(MIGRATION_ID.test(id)).toBe(true));
  it.each(["000_init", "00000_init", "0000-init", "0000_Init", "0000_", "x0000_init", "0000_init\n", "0000_init ", "0000_in-it"])("refuses %j", (id) => expect(MIGRATION_ID.test(id)).toBe(false));
});

describe("assertValidSteps", () => {
  it("accepts an empty list and strictly increasing ids", () => {
    expect(() => assertValidSteps([])).not.toThrow();
    expect(() => assertValidSteps([step("0001_a"), step("0002_b"), step("0010_c")])).not.toThrow();
  });
  it("names a malformed id", () => {
    expect(() => assertValidSteps([step("0001_a"), step("1_b")])).toThrow("migration id '1_b' is not NNNN_snake_name");
  });
  it.each([["duplicate", ["0001_a", "0001_a"]], ["descending", ["0002_b", "0001_a"]], ["descending later", ["0001_a", "0003_c", "0002_b"]]])("refuses %s ids", (_label, ids) => {
    expect(() => assertValidSteps(ids.map(id => step(id)))).toThrow(/is out of order or duplicated \(after '/);
  });
  it.each(["a".repeat(63), "a".repeat(65), "A".repeat(64), `x${"a".repeat(63)}`, `${"a".repeat(63)}g`, "", `${"a".repeat(64)}\n`])("refuses checksum %j", (checksum) => {
    expect(() => assertValidSteps([step("0001_a", checksum)])).toThrow("migration '0001_a' has no sha256 checksum");
  });
  it("accepts a 64-char lowercase hex checksum", () => {
    expect(() => assertValidSteps([step("0001_a", "0123456789abcdef".repeat(4))])).not.toThrow();
  });
});
