import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { createRequire } from "node:module";

import { buildZipFixture } from "../fixtures/build-zip.js";
import { forceRemove } from "../fixtures/force-remove.js";
import { AgentPluginInstallError } from "../../install.js";
import { createAgentPluginLifecycle, type InstallAgentPluginFromUrlRequired } from "../../index.js";
import { ports, resolveAgentPluginLayout } from "../test-support.js";
import type { AgentPluginLayout } from "../../layout.js";
import { createYauzlAgentPluginArchiveReader, type YauzlPort } from "../../yauzl-archive-reader.js";
const require = createRequire(import.meta.url);
const yauzl: YauzlPort = require("yauzl");
const archiveReader = createYauzlAgentPluginArchiveReader({ yauzl });

/** Test composition: production callers must explicitly bind their destination guard and reader.
 * Loopback is authorized only by this fixture; the assertions still reach the real ZIP extractor.
 */
async function installAgentPluginFromUrl(
  required: Omit<InstallAgentPluginFromUrlRequired, "archiveReader">,
  optional: { readonly fetch?: { readonly fetchImpl?: typeof globalThis.fetch; readonly maxBytes?: number } } = {},
) {
  const api = createAgentPluginLifecycle({ ...ports,
    fetch: ({ url }, init) => (optional.fetch?.fetchImpl ?? globalThis.fetch)(url, init),
    outboundGuard: { assertAllowed: async () => {} },
  });
  return api.installAgentPluginFromUrl({ ...required, archiveReader }, {
    fetch: { ...(optional.fetch?.maxBytes !== undefined ? { maxBytes: optional.fetch.maxBytes } : {}) },
  });
}
import { AgentPluginFetchError } from "../../fetch-archive.js";

/**
 * @file End-to-end proof of `installAgentPluginFromUrl()`: a real loopback HTTP server serving a real
 * zip, read by the real `yauzl` adapter (the module's own default — never overridden here), landing
 * on a real temp `cwd`. The happy path doubles no step; rejection cases inject HTTP responses.
 * This is the "URL -> bytes on disk" seam
 * `fetch-archive.ts`'s and `install-from-url.ts`'s own headers describe, proven working together
 * rather than only typechecking together.
 */

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

async function withZipServer(zip: Buffer, run: (url: string) => Promise<void>): Promise<void> {
  const handler = (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "application/zip" });
    res.end(zip);
  };
  const server: Server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the loopback server to report an AddressInfo");
  }
  try {
    await run(`http://127.0.0.1:${address.port}/plugin.zip`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// PARITY: retained URL-to-disk assertions from the host suite.
test("installAgentPluginFromUrl downloads a real archive over loopback HTTP and installs it via the real yauzl reader", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "plugin-install-from-url-test-"));
  try {
    const manifest = JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "ui-ux-design",
      version: "1.1.0",
      description: "UI/UX design skills.",
    });
    const skillMarkdown = "# UI/UX Design\n\nGuidance for interface work.";
    const zip = await buildZipFixture({ entries: [
      { path: "plugin.json", content: manifest },
      { path: "skills/ui-ux-design/SKILL.md", content: skillMarkdown },
    ] });
    const expectedDigest = createHash("sha256").update(zip).digest("hex");

    const layout = resolveAgentPluginLayout({ cwd, env: {} });

    await withZipServer(zip, async (url) => {
      const result = await installAgentPluginFromUrl({
        url,
        integrity: { kind: "pinned", sha256: expectedDigest },
        layout,
        workspaceId: WORKSPACE_ID,
      });

      assert.equal(result.sha256, expectedDigest);
      assert.equal(result.digestWasPinned, true);
      assert.equal(result.resolvedUrl, url);
      assert.equal(result.installed.pluginId, "ui-ux-design");
      assert.deepEqual(result.installed.skills, [{ name: "ui-ux-design", skillPath: "skills/ui-ux-design/SKILL.md" }]);

      const expectedRoot = path.join(cwd, "agent-plugins", "ws", WORKSPACE_ID, "packages", "sha256", expectedDigest);
      assert.equal(result.installed.packageRoot, expectedRoot);

      const info = await stat(expectedRoot);
      assert.equal(info.isDirectory(), true);
      const rootEntries = (await readdir(expectedRoot)).sort();
      assert.deepEqual(rootEntries, ["plugin.json", "skills"]);
      const skillEntries = await readdir(path.join(expectedRoot, "skills", "ui-ux-design"));
      assert.deepEqual(skillEntries, ["SKILL.md"]);
      assert.deepEqual(await readFile(path.join(expectedRoot, "skills", "ui-ux-design", "SKILL.md")), Buffer.from(skillMarkdown, "utf8"));
    });
  } finally {
    await forceRemove(cwd);
  }
});

// PARITY: retained URL-to-disk assertions from the host suite.
test("installAgentPluginFromUrl installs with trust-on-first-use integrity, echoing the downloaded digest as unpinned", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "plugin-install-from-url-test-"));
  try {
    const manifest = JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "trust-first-use-plugin",
    });
    const zip = await buildZipFixture({ entries: [{ path: "plugin.json", content: manifest }] });
    const expectedDigest = createHash("sha256").update(zip).digest("hex");
    const layout = resolveAgentPluginLayout({ cwd, env: {} });

    await withZipServer(zip, async (url) => {
      const result = await installAgentPluginFromUrl({
        url,
        integrity: { kind: "trust-on-first-use" },
        layout,
        workspaceId: WORKSPACE_ID,
      });

      assert.equal(result.digestWasPinned, false);
      assert.equal(result.sha256, expectedDigest);
      assert.equal(result.installed.pluginId, "trust-first-use-plugin");
    });
  } finally {
    await forceRemove(cwd);
  }
});

// PARITY: retained URL-to-disk assertions from the host suite.
test("installAgentPluginFromUrl refuses a pinned digest mismatch with DIGEST_MISMATCH and publishes nothing", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "plugin-install-from-url-test-"));
  try {
    const manifest = JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "ui-ux-design",
    });
    const zip = await buildZipFixture({ entries: [{ path: "plugin.json", content: manifest }] });
    const realDigest = createHash("sha256").update(zip).digest("hex");
    const wrongDigest = "0".repeat(64);
    const layout = resolveAgentPluginLayout({ cwd, env: {} });

    await withZipServer(zip, async (url) => {
      await assert.rejects(
        () =>
          installAgentPluginFromUrl({
            url,
            integrity: { kind: "pinned", sha256: wrongDigest },
            layout,
            workspaceId: WORKSPACE_ID,
          }),
        (error: unknown) => {
          assert.ok(error instanceof AgentPluginInstallError);
          assert.equal(error.code, "DIGEST_MISMATCH");
          assert.equal(
            error.message,
            `archive SHA-256 '${realDigest}' does not match the expected '${wrongDigest}' — refusing to extract unverified bytes`,
          );
          return true;
        },
      );
    });

    // Nothing published: the digest check happens before extraction ever touches the archive
    // reader, so not even the workspace's own `packages/sha256` directory should exist yet, let
    // alone a digest-named directory for the real bytes.
    const workspaceLayout = layout.forWorkspace({ workspaceId: WORKSPACE_ID });
    const expectedRoot = path.join(workspaceLayout.packages, realDigest);
    await assert.rejects(() => stat(expectedRoot), (error: unknown) => {
      return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    });
    for (const directory of [workspaceLayout.packages, workspaceLayout.staging]) {
      await assert.rejects(() => stat(directory), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
    }
  } finally {
    await forceRemove(cwd);
  }
});

async function assertNothingPublishedOrStaged(layout: AgentPluginLayout): Promise<void> {
  const workspace = layout.forWorkspace({ workspaceId: WORKSPACE_ID });
  for (const directory of [workspace.packages, workspace.staging]) {
    const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      assert.equal(error.code, "ENOENT");
      return [];
    });
    assert.deepEqual(entries, [], `${directory} must contain no rejected archive bytes`);
  }
}

for (const status of [404, 500]) {
  // PARITY: retained URL-to-disk assertions from the host suite.
test(`installAgentPluginFromUrl refuses HTTP ${status} even when the response contains a valid plugin ZIP`, async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "plugin-install-from-url-test-"));
    try {
      const zip = await buildZipFixture({ entries: [{ path: "plugin.json", content: JSON.stringify({ name: "error-response-plugin" }) }] });
      const layout = resolveAgentPluginLayout({ cwd, env: {} });
      await assert.rejects(
        () => installAgentPluginFromUrl({ url: "https://plugins.example/plugin.zip", integrity: { kind: "trust-on-first-use" }, layout, workspaceId: WORKSPACE_ID }, {
          fetch: { fetchImpl: async () => new Response(new Uint8Array(zip), { status }) },
        }),
        (error: unknown) => error instanceof AgentPluginFetchError && error.code === "HTTP_ERROR",
      );
      await assertNothingPublishedOrStaged(layout);
    } finally {
      await forceRemove(cwd);
    }
  });
}

// PARITY: retained URL-to-disk assertions from the host suite.
test("installAgentPluginFromUrl enforces the caller's streaming byte cap before publishing a valid ZIP", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "plugin-install-from-url-test-"));
  try {
    const zip = await buildZipFixture({ entries: [{ path: "plugin.json", content: JSON.stringify({ name: "oversized-plugin" }) }] });
    assert.ok(zip.byteLength > 64);
    const layout = resolveAgentPluginLayout({ cwd, env: {} });
    await assert.rejects(
      () => installAgentPluginFromUrl({ url: "https://plugins.example/plugin.zip", integrity: { kind: "trust-on-first-use" }, layout, workspaceId: WORKSPACE_ID }, {
        fetch: { maxBytes: 64, fetchImpl: async () => new Response(new Uint8Array(zip)) },
      }),
      (error: unknown) => error instanceof AgentPluginFetchError && error.code === "ARCHIVE_TOO_LARGE",
    );
    await assertNothingPublishedOrStaged(layout);
  } finally {
    await forceRemove(cwd);
  }
});

// PARITY: retained URL-to-disk assertions from the host suite.
test("installAgentPluginFromUrl refuses a non-ZIP 200 body without published or staged leftovers", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "plugin-install-from-url-test-"));
  try {
    const layout = resolveAgentPluginLayout({ cwd, env: {} });
    await assert.rejects(
      () => installAgentPluginFromUrl({ url: "https://plugins.example/plugin.zip", integrity: { kind: "trust-on-first-use" }, layout, workspaceId: WORKSPACE_ID }, {
        fetch: { fetchImpl: async () => new Response("<html>not a plugin archive</html>") },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /end of central directory|not a zip/i);
        return true;
      },
    );
    await assertNothingPublishedOrStaged(layout);
  } finally {
    await forceRemove(cwd);
  }
});

// PARITY: retained URL-to-disk assertions from the host suite.
test("installAgentPluginFromUrl refuses a ZIP with no plugin manifest and cleans its extracted files", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "plugin-install-from-url-test-"));
  try {
    const zip = await buildZipFixture({ entries: [{ path: "README.md", content: "ordinary ZIP, not a plugin" }] });
    const layout = resolveAgentPluginLayout({ cwd, env: {} });
    await assert.rejects(
      () => installAgentPluginFromUrl({ url: "https://plugins.example/plugin.zip", integrity: { kind: "trust-on-first-use" }, layout, workspaceId: WORKSPACE_ID }, {
        fetch: { fetchImpl: async () => new Response(new Uint8Array(zip)) },
      }),
      (error: unknown) => error instanceof AgentPluginInstallError && error.code === "MANIFEST_MISSING",
    );
    await assertNothingPublishedOrStaged(layout);
  } finally {
    await forceRemove(cwd);
  }
});
