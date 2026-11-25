import type { DragEvent } from "react";

interface DropEntry {
  name: string; fullPath: string; isFile: boolean; isDirectory: boolean;
  file?(resolve: (file: File) => void, reject: (error: Error) => void): void;
  createReader?(): { readEntries(resolve: (entries: DropEntry[]) => void, reject: (error: Error) => void): void };
}
/** Thrown when a walk limit is hit before any SKILL.md showed up: the folder is not a skill, so it keeps the host's folder action. */
const NOT_A_SKILL = Symbol("not-a-skill");

/** Bounded browser directory walk; no host paths or desktop filesystem read permissions needed. */
async function collect(entries: readonly DropEntry[]) {
  const files: File[] = [], paths: string[] = [];
  let total = 0, visited = 0, sawSkill = false;
  const limit = ({ message }: { message: string }, _optional = {}) => sawSkill ? new Error(message) : NOT_A_SKILL;
  async function collectFile({ entry }: { entry: DropEntry }, _options = {}): Promise<void> {
    if (entry.name === "SKILL.md") sawSkill = true;
    const readFile = entry.file;
    if (!readFile) throw new Error(`skill file ${entry.name} cannot be read`);
    const file = await new Promise<File>((resolve, reject) => readFile.call(entry, resolve, reject));
    total += file.size;
    if (files.length >= 256 || total > 8 * 1024 * 1024) throw limit({ message: "Choose up to 256 files, 8 MiB total." });
    files.push(file); paths.push(entry.fullPath.replace(/^\/+/, ""));
  }
  function countVisit({ depth }: { depth: number }, _optional = {}): void {
    visited += 1;
    if (visited > 512 || depth > 16) throw limit({ message: "Skill folder has too many entries or is too deep." });
  }
  async function walk({ entry, depth }: { entry: DropEntry; depth: number }, _optional = {}): Promise<void> {
    countVisit({ depth });
    if (entry.isFile) {
      await collectFile({ entry });
      return;
    }
    if (!entry.isDirectory) return;
    if (!entry.createReader) throw new Error(`skill folder ${entry.name} cannot be read`);
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk({ entry: child, depth: depth + 1 });
    }
  }
  for (const entry of entries) await walk({ entry: entry, depth: 0 });
  return { files, paths };
}

/** Capture before ordinary attachment expansion. Non-skill folders retain the host's folder action. */
export function captureSkillDrop(
  { event, proposeFiles, fallback }: {
    event: DragEvent<HTMLElement>;
    proposeFiles: (files: readonly File[], paths?: readonly string[]) => Promise<void>;
    fallback: (event: DragEvent<HTMLElement>) => void;
  },
  { onError = () => {} }: { onError?: (message: string) => void } = {},
): boolean {
  // Snapshot native items synchronously: browsers protect DataTransfer after the event returns.
  const items = Array.from(event.dataTransfer.items ?? []).filter(item => item.kind === "file").map(item => ({ file: item.getAsFile(), entry: item.webkitGetAsEntry?.() as DropEntry | null }));
  const entries = items.flatMap(item => item.entry ? [item.entry] : []);
  const files = Array.from(event.dataTransfer.files ?? []);
  const hasFolder = entries.some(entry => entry.isDirectory);
  // Folders are captured in browsers too: left to Jini, a folder expands into an attachment upload
  // (owner 2026-10-27: "You can attach at most 10 files"). A skill folder is proposed for install;
  // any other folder goes to the host's folder action (path text, or the paste hint).
  // Every file-only drop must reach the same content-aware uploader as the picker. Capturing ZIPs
  // by suffix here bypasses that classifier and hijacks plugin and ordinary chat attachments.
  if (!hasFolder) return false;
  event.preventDefault(); event.stopPropagation();
  const saved = { ...event, preventDefault: () => {}, stopPropagation: () => {}, dataTransfer: { ...event.dataTransfer, files, types: Array.from(event.dataTransfer.types ?? []), items: items.map(item => ({ kind: "file", getAsFile: () => item.file, webkitGetAsEntry: () => item.entry })) } } as unknown as DragEvent<HTMLElement>;
  // The proposal's own promise is returned so its rejection reaches the catch below.
  void collect(entries).then(({ files: leaves, paths }) =>
    leaves.some(file => file.name === "SKILL.md") ? proposeFiles(leaves, paths) : fallback(saved),
  ).catch(error => {
    if (error === NOT_A_SKILL) fallback(saved);
    else onError(error instanceof Error ? error.message : "Could not read skill folder.");
  });
  return true;
}
