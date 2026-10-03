/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import path from "node:path";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export class PackagePathViolation extends Error {
  constructor({ message }: { readonly message: string }, optional: ErrorOptions = {}) { super(message, optional); }
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const realpath = ports.filesystem.realpath.bind(ports.filesystem);
  function normalizePackageEntryPath(rawEntryPath: string): string {
    if (rawEntryPath.includes("\0")) {
      throw new PackagePathViolation({ message: `package entry path contains a NUL byte: '${rawEntryPath}'` });
    }

    const portable = rawEntryPath.replaceAll("\\", "/");

    if (path.posix.isAbsolute(portable) || /^[a-zA-Z]:/.test(portable)) {
      throw new PackagePathViolation({ message: `package entry path must be relative: '${rawEntryPath}'` });
    }

    const normalized = path.posix.normalize(portable);
    if (normalized === ".." || normalized.startsWith("../") || normalized === "." || normalized === "") {
      throw new PackagePathViolation({ message: `package entry path escapes the package root: '${rawEntryPath}'` });
    }

    return normalized;
  }

  async function assertContainedOnDisk(packageRoot: string, entryPath: string): Promise<string> {
    const normalized = normalizePackageEntryPath(entryPath);
    const realRoot = await realpath(packageRoot);
    const lexicalCandidate = path.resolve(realRoot, normalized);

    if (!isWithin(realRoot, lexicalCandidate)) {
      throw new PackagePathViolation({ message: `package entry resolves outside the package root: '${entryPath}'` });
    }

    let realCandidate: string;
    try {
      realCandidate = await realpath(lexicalCandidate);
    } catch {
      realCandidate = await realpathDeepestExistingAncestor(lexicalCandidate);
    }

    if (!isWithin(realRoot, realCandidate)) {
      throw new PackagePathViolation({ message: `package entry resolves outside the package root via a symlink: '${entryPath}'` });
    }

    return lexicalCandidate;
  }

  function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  }

  async function realpathDeepestExistingAncestor(candidate: string): Promise<string> {
    let current = path.dirname(candidate);
    const tail: string[] = [path.basename(candidate)];

    for (;;) {
      try {
        const real = await realpath(current);
        return path.join(real, ...tail);
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return path.join(current, ...tail); // reached the filesystem root
        tail.unshift(path.basename(current));
        current = parent;
      }
    }
  }

  return { normalizePackageEntryPath, assertContainedOnDisk };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createPackagePathsModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
