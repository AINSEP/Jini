import { describe, expect, it } from "vitest";
import { copyableDetails } from "../copyable-details.js";

describe("copyableDetails", () => {
  it("strips the Electron prefix and user folders on every platform", () => {
    expect(copyableDetails({ error: new Error("Error invoking remote method 'x': boom in /home/ann/a and C:\\Users\\Bo\\b") })).toBe("boom in ~/a and ~\\b");
  });

  it("stringifies a non-Error and trims", () => {
    expect(copyableDetails({ error: "  plain /Users/jo/x  " })).toBe("plain ~/x");
  });
});
