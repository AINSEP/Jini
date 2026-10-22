import { describe, expect, it } from "vitest";
import { findMacOSCrashReports } from "../sources.js";
import type { DiagnosticsSystemPort } from "../ports.js";
import { discoveryFilesystem } from "./l170-filesystem.fake.js";

const day = 24 * 60 * 60 * 1000;
const clock = { nowMs: () => 20 * day };
const system: DiagnosticsSystemPort = {
  platform: () => "darwin",
  machineInfo: () => { throw new Error("Crash lookup must not request machine info"); },
};

describe("macOS crash discovery characterization", () => {
  it("returns before reading the clock or filesystem on other platforms", async () => {
    const directoryReads: string[] = [];
    const filesystem = discoveryFilesystem({ directories: {}, stats: {} }, { directoryReads });
    expect(await findMacOSCrashReports({
      matchSubstrings: ["app"], filesystem, system: { ...system, platform: () => "linux" },
      clock: { nowMs: () => { throw new Error("Clock must not be read"); } },
    })).toEqual([]);
    expect(directoryReads).toEqual([]);
  });

  it("skips read/stat failures, unmatched names, non-files and stale files; keeps the cutoff and stable ties", async () => {
    const statReads: string[] = [];
    const filesystem = discoveryFilesystem({
      directories: {
        "/denied": new Error("denied"),
        "/reports": [
          { name: "other.crash", isDirectory: false }, { name: "App-missing", isDirectory: false },
          { name: "App-dir", isDirectory: true }, { name: "App-stale", isDirectory: false },
          { name: "APP-cutoff", isDirectory: false }, { name: "app-new", isDirectory: false },
          { name: "App-tie", isDirectory: false }, { name: "Engine-crash", isDirectory: false },
        ],
      },
      stats: {
        "/reports/App-missing": new Error("gone"), "/reports/App-dir": { isFile: false, mtimeMs: 20 * day },
        "/reports/App-stale": { isFile: true, mtimeMs: 13 * day - 1 },
        "/reports/APP-cutoff": { isFile: true, mtimeMs: 13 * day },
        "/reports/app-new": { isFile: true, mtimeMs: 20 * day },
        "/reports/App-tie": { isFile: true, mtimeMs: 20 * day },
        "/reports/Engine-crash": { isFile: true, mtimeMs: 19 * day },
      },
    }, { statReads });
    expect(await findMacOSCrashReports({ matchSubstrings: ["aPp", "ENGINE"], filesystem, clock, system }, {
      searchDirs: ["/denied", "/reports"],
    })).toEqual([
      { name: "crash-reports/app-new", absolutePath: "/reports/app-new", kind: "text" },
      { name: "crash-reports/App-tie", absolutePath: "/reports/App-tie", kind: "text" },
      { name: "crash-reports/Engine-crash", absolutePath: "/reports/Engine-crash", kind: "text" },
      { name: "crash-reports/APP-cutoff", absolutePath: "/reports/APP-cutoff", kind: "text" },
    ]);
    expect(statReads).toEqual([
      "/reports/App-missing", "/reports/App-dir", "/reports/App-stale", "/reports/APP-cutoff",
      "/reports/app-new", "/reports/App-tie", "/reports/Engine-crash",
    ]);
  });

  it.each([
    { options: {}, expected: ["/Library/Logs/DiagnosticReports"] },
    { options: { homeDir: "/home/test" }, expected: ["/home/test/Library/Logs/DiagnosticReports", "/Library/Logs/DiagnosticReports"] },
    { options: { homeDir: "" }, expected: ["/Library/Logs/DiagnosticReports"] },
    { options: { homeDir: "/ignored", searchDirs: ["/custom"] }, expected: ["/custom"] },
    { options: { homeDir: "/ignored", searchDirs: [] }, expected: [] },
  ])("resolves directory options $options", async ({ options, expected }) => {
    const directoryReads: string[] = [];
    const filesystem = discoveryFilesystem({ directories: {}, stats: {} }, { directoryReads });
    expect(await findMacOSCrashReports({ matchSubstrings: ["app"], filesystem, clock, system }, options)).toEqual([]);
    expect(directoryReads).toEqual(expected);
  });

  it.each([
    { matchSubstrings: [], expected: [] },
    { matchSubstrings: [""], expected: ["other.crash"] },
  ])("preserves empty match semantics $matchSubstrings", async ({ matchSubstrings, expected }) => {
    const statReads: string[] = [];
    const filesystem = discoveryFilesystem({
      directories: { "/reports": [{ name: "other.crash", isDirectory: false }] },
      stats: { "/reports/other.crash": { isFile: true, mtimeMs: clock.nowMs() } },
    }, { statReads });
    expect(await findMacOSCrashReports({ matchSubstrings, filesystem, clock, system }, { searchDirs: ["/reports"] }))
      .toEqual(expected.map((name) => ({ name: `crash-reports/${name}`, absolutePath: `/reports/${name}`, kind: "text" })));
    expect(statReads).toEqual(expected.map((name) => `/reports/${name}`));
  });

  it.each([{ maxReports: 1, count: 1 }, { maxReports: 0, count: 0 }, { maxReports: -1, count: 2 }])(
    "preserves report maxReports=$maxReports and explicit zero-day cutoff", async ({ maxReports, count }) => {
      const filesystem = discoveryFilesystem({
        directories: { "/reports": ["app-stale", "app-a", "app-b", "app-c"].map((name) => ({ name, isDirectory: false })) },
        stats: {
          "/reports/app-stale": { isFile: true, mtimeMs: clock.nowMs() - 1 },
          "/reports/app-a": { isFile: true, mtimeMs: clock.nowMs() + 2 },
          "/reports/app-b": { isFile: true, mtimeMs: clock.nowMs() + 1 },
          "/reports/app-c": { isFile: true, mtimeMs: clock.nowMs() },
        },
      });
      const result = await findMacOSCrashReports({ matchSubstrings: ["app"], filesystem, clock, system }, {
        searchDirs: ["/reports"], withinDays: 0, maxReports,
      });
      expect(result).toEqual(["app-a", "app-b", "app-c"].slice(0, count).map((name) => ({
        name: `crash-reports/${name}`, absolutePath: `/reports/${name}`, kind: "text",
      })));
    },
  );

  it("caps default report discovery at twenty", async () => {
    const filesystem = discoveryFilesystem({
      directories: { "/reports": Array.from({ length: 21 }, (_, n) => ({ name: `app-${n}`, isDirectory: false })) },
      stats: Object.fromEntries(Array.from({ length: 21 }, (_, n) => [
        `/reports/app-${n}`, { isFile: true, mtimeMs: clock.nowMs() + n },
      ])),
    });
    const result = await findMacOSCrashReports({ matchSubstrings: ["app"], filesystem, clock, system }, { searchDirs: ["/reports"] });
    expect(result.map(({ name }) => name)).toEqual(Array.from({ length: 20 }, (_, n) => `crash-reports/app-${20 - n}`));
  });
});
