import { describe, expect, it } from "vitest";

import type { ServerLogEntry } from "@jini-ai/core/contracts/site/platform-server-logs";
import {
  type RecentErrorGroup,
  SUMMARY_MAX_LENGTH,
  formatErrorCopyText,
  groupErrorEntries,
  normalizeErrorMessage,
  segmentErrorPaths,
  shortenSourcePath,
  summarizeErrorMessage,
} from "../recent-errors-rules.js";

/** @file Pure shaping for the Recent errors tab — summary line, grouping, path shortening, copy text. */

const DAEMON_PATH = "/Users/la/Programming/my-site/apps/website/src/server/runtime/composition/modules/assistant-daemon-client.ts:230:24";
const DAEMON_ERROR = [
  "[assistant] agent daemon unreachable at http://127.0.0.1:51384",
  "TypeError: fetch failed",
  "    at node:internal/deps/undici/undici:15482:13",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
  `    at async fetchAgentDaemon (${DAEMON_PATH})`,
].join("\n");

/**
 * The live repro (a dev site's server.log, 2026-10-09T01:04Z): one daemon outage logged from two
 * call sites. Same tag, headline and `[cause]`; only the caller's stack frame differs.
 */
function daemonOutage(caller: string): string {
  return [
    "[assistant] agent daemon unreachable at http://127.0.0.1:57475 TypeError: fetch failed",
    "    at node:internal/deps/undici/undici:15482:13",
    `    at async fetchAgentDaemon (${DAEMON_PATH})`,
    `    at async ${caller} {`,
    "  [cause]: Error: connect ECONNREFUSED 127.0.0.1:57475",
    "      at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16) {",
    "    code: 'ECONNREFUSED',",
    "    port: 57475",
    "  }",
    "}",
  ].join("\n");
}
const VIA_PROXY = daemonOutage("proxyPassthrough (/Users/la/Programming/my-site/apps/website/src/server/runtime/composition/modules/assistant.ts:180:20)");
const VIA_AGENT_LIST = daemonOutage("respondWithEnrichedAgentList (/Users/la/Programming/my-site/apps/website/src/server/runtime/composition/modules/assistant.ts:284:20)");

/** The group at `index`; an absent one fails the test loudly instead of flowing on as `undefined`. */
function groupAt(groups: readonly RecentErrorGroup[], index: number): RecentErrorGroup {
  const group = groups[index];
  if (group === undefined) throw new Error(`expected a group at index ${index}, got ${groups.length} group(s)`);
  return group;
}

function entry(seq: number, message: string, overrides: Partial<ServerLogEntry> = {}): ServerLogEntry {
  return { seq, at: `2026-10-08T17:0${seq}:00.000Z`, level: "error", source: "server", message, ...overrides };
}

describe("summarizeErrorMessage", () => {
  it("skips plain context lines between the headline and the thrown error", () => {
    expect(summarizeErrorMessage({ message: "[cms] publish failed\nwhile writing site-a\nRangeError: out of space\n    at write (x.ts:1:1)" })).toEqual({
      scope: "cms",
      summary: "publish failed — out of space",
    });
  });

  it("joins the first line and the thrown error's text, and lifts the [tag] out", () => {
    expect(summarizeErrorMessage({ message: DAEMON_ERROR })).toEqual({
      scope: "assistant",
      summary: "agent daemon unreachable at http://127.0.0.1:51384 — fetch failed",
    });
  });

  it("keeps a first line that is itself the thrown error, without repeating it", () => {
    expect(summarizeErrorMessage({ message: "TypeError: fetch failed\n    at x (/a/b.ts:1:2)" })).toEqual({ scope: null, summary: "TypeError: fetch failed" });
  });

  it("ignores error-shaped text that only appears after the stack frames begin", () => {
    expect(summarizeErrorMessage({ message: "boom\n    at x (/a/b.ts:1:2)\nTypeError: later" }).summary).toBe("boom");
  });

  it("skips leading blank lines and uses Caused by text", () => {
    expect(summarizeErrorMessage({ message: "\n  \nsave failed\nCaused by: disk full" }).summary).toBe("save failed — disk full");
  });

  it("falls back to the cause, then to the bare tag, when the first line has no text of its own", () => {
    expect(summarizeErrorMessage({ message: "[assistant]\nError: no route" })).toEqual({ scope: "assistant", summary: "no route" });
    expect(summarizeErrorMessage({ message: "[assistant]" })).toEqual({ scope: "assistant", summary: "[assistant]" });
  });

  it("returns an empty summary for an empty message", () => {
    expect(summarizeErrorMessage({ message: " \n " })).toEqual({ scope: null, summary: "" });
  });

  it("cuts a very long line to the cap with an ellipsis", () => {
    const summary = summarizeErrorMessage({ message: "x".repeat(500) }).summary;
    expect(summary).toHaveLength(SUMMARY_MAX_LENGTH);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("shortenSourcePath", () => {
  it.each([
    [DAEMON_PATH, "apps/website/src/server/runtime/composition/modules/assistant-daemon-client.ts:230:24"],
    ["file:///Users/la/Programming/Jini/packages/ui/dist/index.js:4:1", "packages/ui/dist/index.js:4:1"],
    ["/Users/la/my-site/apps/admin/node_modules/@jini-ai/core/node_modules/undici/index.js", "node_modules/undici/index.js"],
    ["/home/dev/scratch/run.ts:9", "~/scratch/run.ts:9"],
    ["/opt/app/server.js:1:1", "/opt/app/server.js:1:1"],
  ])("%s -> %s", (path, expected) => {
    expect(shortenSourcePath({ path })).toBe(expected);
  });
});

describe("segmentErrorPaths", () => {
  it("splits shortened paths out, each keeping its full path, and leaves the rest as plain text", () => {
    expect(segmentErrorPaths({ message: `at fetch (${DAEMON_PATH})\nat other (/opt/app/server.js:1:1)` })).toEqual([
      { text: "at fetch (" },
      { text: "apps/website/src/server/runtime/composition/modules/assistant-daemon-client.ts:230:24", fullPath: DAEMON_PATH },
      { text: ")\nat other (/opt/app/server.js:1:1)" },
    ]);
  });

  it("does not treat a URL's path, node: internals, or a lone slash word as file paths", () => {
    const message = "unreachable at http://127.0.0.1:51384/api/run (node:internal/deps/undici:1:2) and/or";
    expect(segmentErrorPaths({ message })).toEqual([{ text: message }]);
  });

  it("returns no segments for an empty message and handles back-to-back paths", () => {
    expect(segmentErrorPaths({ message: "" })).toEqual([]);
    expect(segmentErrorPaths({ message: "/u/x/apps/a.ts /u/x/apps/b.ts" })).toEqual([
      { text: "apps/a.ts", fullPath: "/u/x/apps/a.ts" },
      { text: " " },
      { text: "apps/b.ts", fullPath: "/u/x/apps/b.ts" },
    ]);
  });
});

describe("groupErrorEntries", () => {
  it("groups identical source+message, newest occurrence first, with first and last occurrence", () => {
    const groups = groupErrorEntries({
      entries: [entry(1, "A"), entry(2, "B"), entry(3, "A"), entry(4, "A", { source: "daemon" }), entry(5, "A")],
    });
    expect(groups.map((group) => [group.latest.seq, group.earliest.seq, group.count, group.latest.source, group.latest.message])).toEqual([
      [5, 1, 3, "server", "A"],
      [4, 4, 1, "daemon", "A"],
      [2, 2, 1, "server", "B"],
    ]);
  });

  it("keeps messages that differ by one character apart, and keeps the same key across reloads", () => {
    const first = groupErrorEntries({ entries: [entry(1, "port 51384"), entry(2, "port 51205")] });
    expect(first).toHaveLength(2);
    const reloaded = groupErrorEntries({ entries: [entry(1, "port 51384"), entry(2, "port 51205"), entry(3, "port 51384")] });
    expect(groupAt(reloaded, 0).key).toBe(groupAt(first, 1).key);
  });

  it("merges errors that render identically but were logged from different call sites (stack frames differ)", () => {
    const entries = [entry(1, VIA_PROXY), entry(2, VIA_AGENT_LIST), entry(3, VIA_AGENT_LIST), entry(4, VIA_PROXY)];
    const groups = groupErrorEntries({ entries });
    expect(groups.map((group) => [group.count, group.latest.seq, group.earliest.seq])).toEqual([[4, 4, 1]]);
    // The newest occurrence's FULL message is kept, stack and all, for Copy.
    expect(groupAt(groups, 0).latest.message).toBe(VIA_PROXY);
    expect(formatErrorCopyText({ group: groupAt(groups, 0) })).toBe(
      `Time: 2026-10-08T17:04:00.000Z\nSource: server\nOccurrences: 4 (first 2026-10-08T17:01:00.000Z, last 2026-10-08T17:04:00.000Z)\nMessage:\n${VIA_PROXY}`,
    );
    // Refresh: a new occurrence from the other call site keeps the same key, so an open row stays open.
    const refreshed = groupErrorEntries({ entries: [...entries, entry(5, VIA_AGENT_LIST)] });
    expect(refreshed.map((group) => [group.key, group.count])).toEqual([[groupAt(groups, 0).key, 5]]);
  });

  it("still separates errors that differ outside stack frames — port, tag, cause code, source", () => {
    const groups = groupErrorEntries({
      entries: [
        entry(1, VIA_PROXY),
        entry(2, VIA_PROXY.replaceAll("57475", "51384")),
        entry(3, VIA_PROXY.replace("[assistant]", "[chat]")),
        entry(4, VIA_PROXY.replace("'ECONNREFUSED'", "'ETIMEDOUT'")),
        entry(5, VIA_PROXY, { source: "daemon" }),
      ],
    });
    expect(groups.map((group) => group.latest.seq)).toEqual([5, 4, 3, 2, 1]);
  });

  it("merges errors that differ only by an embedded timestamp or labeled request id", () => {
    const groups = groupErrorEntries({
      entries: [
        entry(1, "job failed at 2026-10-08T17:01:00.000Z { requestId: 'r-1' }"),
        entry(2, "job failed at 2026-10-08T17:02:30.512Z { requestId: 'r-2' }"),
      ],
    });
    expect(groups.map((group) => [group.count, group.latest.message])).toEqual([[2, "job failed at 2026-10-08T17:02:30.512Z { requestId: 'r-2' }"]]);
  });

  it("returns nothing for no entries", () => {
    expect(groupErrorEntries({ entries: [] })).toEqual([]);
  });
});

describe("normalizeErrorMessage", () => {
  it("drops stack-frame lines (nested cause frames too) and keeps everything else verbatim", () => {
    expect(normalizeErrorMessage({ message: VIA_PROXY })).toBe(
      [
        "[assistant] agent daemon unreachable at http://127.0.0.1:57475 TypeError: fetch failed",
        "  [cause]: Error: connect ECONNREFUSED 127.0.0.1:57475",
        "    code: 'ECONNREFUSED',",
        "    port: 57475",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(normalizeErrorMessage({ message: VIA_AGENT_LIST })).toBe(normalizeErrorMessage({ message: VIA_PROXY }));
  });

  it("masks ISO timestamps and labeled request/trace ids, and trims trailing spaces", () => {
    expect(normalizeErrorMessage({ message: "failed 2026-10-09T01:04:17.785Z \r\n{\"request_id\":\"abc\", traceId=x.y}" })).toBe(
      "failed <time>\n{\"request_id\":\"<id>\", traceId=<id>}",
    );
  });

  it("leaves prose that only mentions a request id, and unlabeled ids, alone", () => {
    expect(normalizeErrorMessage({ message: "request id was missing for 7f3c" })).toBe("request id was missing for 7f3c");
  });
});

describe("formatErrorCopyText", () => {
  it("is a paste-ready block with ISO time, source and the full message with unshortened paths", () => {
    const group = groupAt(groupErrorEntries({ entries: [entry(1, DAEMON_ERROR)] }), 0);
    expect(formatErrorCopyText({ group })).toBe(`Time: 2026-10-08T17:01:00.000Z\nSource: server\nMessage:\n${DAEMON_ERROR}`);
  });

  it("adds an occurrences line for a repeated error", () => {
    const group = groupAt(groupErrorEntries({ entries: [entry(1, "A"), entry(3, "A")] }), 0);
    expect(formatErrorCopyText({ group })).toBe(
      "Time: 2026-10-08T17:03:00.000Z\nSource: server\nOccurrences: 2 (first 2026-10-08T17:01:00.000Z, last 2026-10-08T17:03:00.000Z)\nMessage:\nA",
    );
  });

  it("carries the server's redaction markers through verbatim — nothing is un-redacted", () => {
    const message = "provider rejected Authorization: Bearer [REDACTED:bearer_token] (key=[REDACTED:api_key_query])";
    const group = groupAt(groupErrorEntries({ entries: [entry(1, message)] }), 0);
    const text = formatErrorCopyText({ group });
    expect(text).toContain("Bearer [REDACTED:bearer_token]");
    expect(text).toContain("key=[REDACTED:api_key_query]");
    expect(text.endsWith(message)).toBe(true);
  });
});

it("continues past a colon with no same-line message but preserves whitespace-only causes", () => {
  expect(summarizeErrorMessage({ message: "Save failed\nError:\u2028\nRangeError: disk full" })).toEqual({
    scope: null, summary: "Save failed — disk full",
  });
  expect(summarizeErrorMessage({ message: "Save failed\nError:\t\u2028" })).toEqual({
    scope: null, summary: "Save failed — \t",
  });
  expect(summarizeErrorMessage({ message: "Save failed\nError: across\u2028lines\nRangeError: disk full" }).summary).toBe("Save failed — disk full");
});
