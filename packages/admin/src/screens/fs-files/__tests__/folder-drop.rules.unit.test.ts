import { describe, expect, it } from "vitest";

import { confirmationNotice, dropHasFolder, reasonForCustomRootFailure } from "../folder-drop.rules.js";

function transfer(items: readonly unknown[]): DataTransfer {
  return { items, files: [] } as unknown as DataTransfer;
}

describe("reasonForCustomRootFailure", () => {
  it("reads 'does not exist' off an INVALID_PATH message", () => {
    expect(reasonForCustomRootFailure({ failure: { code: "INVALID_PATH", message: "'/x' does not exist" } })).toBe("does-not-exist");
  });

  it("treats any other INVALID_PATH message (or none) as not-a-directory", () => {
    expect(reasonForCustomRootFailure({ failure: { code: "INVALID_PATH", message: "'/x' is not a directory" } })).toBe("not-a-directory");
    expect(reasonForCustomRootFailure({ failure: { code: "INVALID_PATH", message: "" } })).toBe("not-a-directory");
  });

  it("never infers a validation reason from another code, or from a non-API failure", () => {
    expect(reasonForCustomRootFailure({ failure: { code: "UNAVAILABLE", message: "does not exist" } })).toBe("endpoint-unreachable");
    expect(reasonForCustomRootFailure({ failure: { code: undefined, message: "does not exist" } })).toBe("endpoint-unreachable");
    expect(reasonForCustomRootFailure({ failure: null })).toBe("endpoint-unreachable");
  });
});

describe("dropHasFolder", () => {
  it("is true only for a file item whose entry is a directory", () => {
    const dir = { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) };
    expect(dropHasFolder({ dataTransfer: transfer([{ kind: "string" }, dir]) })).toBe(true);
    expect(dropHasFolder({ dataTransfer: transfer([{ kind: "string", webkitGetAsEntry: () => ({ isDirectory: true }) }]) })).toBe(false);
    expect(dropHasFolder({ dataTransfer: transfer([{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }) }]) })).toBe(false);
    expect(dropHasFolder({ dataTransfer: transfer([{ kind: "file", webkitGetAsEntry: () => null }, { kind: "file" }]) })).toBe(false);
  });

  it("tolerates a transfer with no items list", () => {
    expect(dropHasFolder({ dataTransfer: {} as DataTransfer })).toBe(false);
  });
});

describe("confirmationNotice", () => {
  it("names the replaced root only when it changed", () => {
    expect(confirmationNotice({ path: "/a", previousPath: "/old" })).toEqual({ kind: "confirmation", path: "/a", replacedPreviousPath: "/old" });
    expect(confirmationNotice({ path: "/a", previousPath: "/a" })).toEqual({ kind: "confirmation", path: "/a", replacedPreviousPath: null });
    expect(confirmationNotice({ path: "/a", previousPath: null })).toEqual({ kind: "confirmation", path: "/a", replacedPreviousPath: null });
  });

  it("lists the drop's folders only when there was more than one", () => {
    expect(confirmationNotice({ path: "/b", previousPath: null }, { paths: ["/a", "/b"] })).toEqual({
      kind: "confirmation", path: "/b", paths: ["/a", "/b"], replacedPreviousPath: null,
    });
    expect(confirmationNotice({ path: "/b", previousPath: null }, { paths: ["/b"] })).not.toHaveProperty("paths");
  });
});
