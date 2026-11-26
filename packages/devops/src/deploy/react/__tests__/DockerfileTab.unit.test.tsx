import { expect, it, vi } from "vitest";
import { downloadDockerfile } from "../download-dockerfile.js";

it("creates the URL, clicks the download, then revokes the URL", () => {
  const order: string[] = [];
  const anchor = { href: "", download: "", click: vi.fn(() => { order.push("click"); }) };
  downloadDockerfile({ contents: "FROM scratch", Blob,
    URL: { createObjectURL: vi.fn(() => { order.push("create"); return "blob:dockerfile"; }),
      revokeObjectURL: vi.fn(() => { order.push("revoke"); }) },
    document: { createElement: () => anchor },
  });
  expect(anchor.href).toBe("blob:dockerfile");
  expect(anchor.download).toBe("Dockerfile");
  expect(order).toEqual(["create", "click", "revoke"]);
});
