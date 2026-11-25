import fs from "node:fs";
import type { JsonFileRead } from "@jini-ai/core/contracts/site/fs-durable-json";
import type { ImportPayloadFs } from "../import-index/payload-namespace.js";
import type { SiteImportRegistry } from "../import-registry.js";

/** @file Plain node-fs payload ports for registry tests: the registry is exercised against injected deps only. */

/** A real-disk `ImportPayloadFs`; the hosts bind their own durable implementation. */
export function nodePayloadFs(_required: Record<string, never> = {}): ImportPayloadFs {
  return {
    readdir: ({ dir }) => fs.readdirSync(dir),
    kind: ({ file }) => {
      if (!fs.existsSync(file)) return "missing";
      const stat = fs.lstatSync(file);
      if (stat.isFile()) return "file";
      return stat.isDirectory() ? "directory" : "other";
    },
    rename: ({ from, to }) => fs.renameSync(from, to),
    rm: ({ file, recursive }) => fs.rmSync(file, { recursive, force: true }),
    mkdir: ({ dir, mode }) => fs.mkdirSync(dir, { mode }),
    chmod: ({ file, mode }) => fs.chmodSync(file, mode),
    writeExclusive: ({ file, mode }) => { fs.closeSync(fs.openSync(file, "wx", mode)); },
    fsyncFile: () => undefined,
    fsyncDir: () => undefined,
  };
}

type Payload = ConstructorParameters<typeof SiteImportRegistry>[0]["payload"];

/** Payload ports over plain JSON files, recording every file written and every lock taken. */
export function nodePayload(required: { writes: string[]; locks: { lockPath: string; staleMs: number }[] }): Payload {
  const readJsonAt = ({ file }: { file: string }): JsonFileRead => {
    if (!fs.existsSync(file)) return { state: "missing" };
    try { return { state: "ok", value: JSON.parse(fs.readFileSync(file, "utf8")) as unknown }; } catch { return { state: "unreadable" }; }
  };
  return {
    fs: nodePayloadFs({}), clock: { nowMs: () => Date.now() }, readJsonAt,
    writeJsonAt: ({ file, value }) => { required.writes.push(file); fs.writeFileSync(file, JSON.stringify(value)); },
    lock: { withFileLock: async ({ lockPath, run }: { lockPath: string; run: () => Promise<unknown> }, { staleMs }: { staleMs: number }) => {
      required.locks.push({ lockPath, staleMs });
      return run();
    } } as unknown as Payload["lock"],
  };
}
