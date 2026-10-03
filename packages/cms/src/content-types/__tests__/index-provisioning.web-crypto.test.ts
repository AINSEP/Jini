import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { buildQueryableFieldIndexName } from "../index-provisioning.js";

// PARITY
test.each(["", "ws-1", "workspace/with spaces", "工作区/é/😀", "a\0b", "\ud800", "\udc00"])(
  "Web Crypto preserves the historical index identity for %j",
  async (workspaceId) => {
    const segment = createHash("sha256").update(workspaceId).digest("hex").slice(0, 16);
    expect(await buildQueryableFieldIndexName({ workspaceId, contentTypeKey: "article", fieldName: "title" }))
      .toBe(`q/w${segment}/article/title`);
  },
);

// PARITY
test("empty workspace pins the SHA-256 prefix including its lowercase hex encoding", async () => {
  expect(await buildQueryableFieldIndexName({ workspaceId: "", contentTypeKey: "article", fieldName: "title" }))
    .toBe("q/we3b0c44298fc1c14/article/title");
});

// REGRESSION: fails if buildQueryableFieldIndexName returns a synchronous string again.
test("valid index-name calls return a promise and snapshot their grammar-checked inputs", async () => {
  const input = { workspaceId: "", contentTypeKey: "article", fieldName: "title" };
  const result = buildQueryableFieldIndexName(input);
  expect(result).toBeInstanceOf(Promise);
  input.workspaceId = "changed";
  input.contentTypeKey = "bad/key";
  input.fieldName = "bad/field";
  expect(await result).toBe("q/we3b0c44298fc1c14/article/title");
});

// PARITY
test("index segments cannot collide by shifting the content-type/field boundary", async () => {
  const first = await buildQueryableFieldIndexName({ workspaceId: "", contentTypeKey: "a_b", fieldName: "c" });
  const second = await buildQueryableFieldIndexName({ workspaceId: "", contentTypeKey: "a", fieldName: "b_c" });
  expect(first).toBe("q/we3b0c44298fc1c14/a_b/c");
  expect(second).toBe("q/we3b0c44298fc1c14/a/b_c");
  expect(first).not.toBe(second);
});

// REGRESSION: fails if workspaceIndexSegment uses createHash instead of crypto.subtle.digest.
test("Web Crypto digest failures reject the promise without inventing a fallback identity", async () => {
  const failure = new Error("digest unavailable");
  const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(failure);
  try {
    await expect(buildQueryableFieldIndexName({ workspaceId: "", contentTypeKey: "article", fieldName: "title" }))
      .rejects.toBe(failure);
    expect(digest).toHaveBeenCalledWith("SHA-256", new Uint8Array());
  } finally {
    digest.mockRestore();
  }
});
