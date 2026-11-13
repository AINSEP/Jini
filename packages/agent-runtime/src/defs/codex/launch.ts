import { accessSync, closeSync, constants, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AgentLaunchResolution } from '../../launch.js';

export function resolveCodexLaunch(selectedPath: string, childPathPrepend: string[]): Pick<AgentLaunchResolution, 'launchPath' | 'launchKind' | 'childPathPrepend' | 'diagnostic'> {
  const native = tryResolveCodexNativeBinary(selectedPath);
  return {
    launchPath: native.path ?? selectedPath,
    launchKind: native.path ? 'codex-native' : 'selected',
    childPathPrepend: [...childPathPrepend, ...native.childPathPrepend],
    diagnostic: native.diagnostic,
  };
}

function tryResolveCodexNativeBinary(wrapperPath: string): {
  path: string | null;
  childPathPrepend: string[];
  diagnostic: string | null;
} {
  const packageSuffix = codexNativePackageSuffix();
  const targetTriple = codexNativeTargetTriple();
  for (const root of codexSearchRoots(wrapperPath)) {
    for (const candidate of codexNativeCandidates(root, packageSuffix, targetTriple)) {
      if (isExecutableFile(candidate.path)) {
        return { path: candidate.path, childPathPrepend: existingDirectories(candidate.childPathPrepend), diagnostic: null };
      }
    }
  }
  if (!looksLikeCodexNodeWrapper(wrapperPath)) return { path: null, childPathPrepend: [], diagnostic: null };
  return {
    path: null,
    childPathPrepend: [],
    diagnostic: `Codex native binary was not found for ${packageSuffix}/${targetTriple}; falling back to wrapper ${wrapperPath}. Set CODEX_BIN to a native Codex binary if this wrapper cannot launch from a GUI environment.`,
  };
}

function codexSearchRoots(wrapperPath: string): string[] {
  const resolved = safeRealpath(wrapperPath) ?? wrapperPath;
  const directory = path.dirname(resolved);
  // npm bin symlinks resolve inside @openai/codex/bin. Only that package's
  // install directory owns the upgrade; ancestors of the shim or package do not.
  if (path.basename(directory) !== 'bin' || path.basename(path.dirname(directory)) !== 'codex') return [directory];
  const packageDir = path.dirname(directory);
  const scopeDir = path.dirname(packageDir);
  // Hoisted npm and pnpm layouts put the native package beside @openai/codex in the same
  // node_modules; that tree already owns the wrapper, so it is not an ancestor search.
  const ownsHoistedSibling = path.basename(scopeDir) === '@openai' && path.basename(path.dirname(scopeDir)) === 'node_modules';
  return ownsHoistedSibling ? [packageDir, path.dirname(path.dirname(scopeDir))] : [packageDir];
}

function codexNativeCandidates(
  root: string,
  packageSuffix: string,
  targetTriple: string,
): Array<{ path: string; childPathPrepend: string[] }> {
  const scoped = path.join(root, 'node_modules', '@openai');
  const packageDirs = [path.join(scoped, `codex-${packageSuffix}`)];
  try {
    for (const entry of readdirSync(scoped, { encoding: 'utf8', withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('codex-')) packageDirs.push(path.join(scoped, entry.name));
    }
  } catch {
    // Optional package layouts vary by npm version; absence uses wrapper fallback.
  }
  return [...new Set(packageDirs)].flatMap((dir) => {
    const vendorPathDir = path.join(dir, 'vendor', targetTriple, 'path');
    const childPathPrepend = [vendorPathDir];
    return [
      { path: path.join(dir, 'vendor', targetTriple, 'codex', 'codex'), childPathPrepend },
      { path: path.join(dir, 'vendor', targetTriple, 'codex', 'codex.exe'), childPathPrepend },
      { path: path.join(dir, 'codex'), childPathPrepend },
      { path: path.join(dir, 'bin', 'codex'), childPathPrepend },
      { path: path.join(dir, 'vendor', 'codex'), childPathPrepend },
      { path: path.join(dir, 'codex.exe'), childPathPrepend },
      { path: path.join(dir, 'bin', 'codex.exe'), childPathPrepend },
    ];
  });
}

function codexNativePackageSuffix(): string {
  return `${process.platform}-${process.arch}`;
}

const CODEX_NATIVE_TARGET_TRIPLES: ReadonlyMap<string, string> = new Map([
  ['darwin-arm64', 'aarch64-apple-darwin'],
  ['darwin-x64', 'x86_64-apple-darwin'],
  ['linux-arm64', 'aarch64-unknown-linux-musl'],
  ['linux-x64', 'x86_64-unknown-linux-musl'],
  ['win32-arm64', 'aarch64-pc-windows-msvc'],
  ['win32-x64', 'x86_64-pc-windows-msvc'],
]);

// Unmapped platform/arch pairs fall back to the npm package suffix itself.
function codexNativeTargetTriple(): string {
  const suffix = codexNativePackageSuffix();
  return CODEX_NATIVE_TARGET_TRIPLES.get(suffix) ?? suffix;
}

function looksLikeCodexNodeWrapper(filePath: string): boolean {
  // Read only the first 64KB rather than slurping the whole file: the
  // selected codex path can now be the native Codex.app binary (~190MB),
  // and `readFileSync` would otherwise load all of it into a string just
  // to sniff a shebang. A node wrapper is a tiny script, so the header is
  // enough.
  let fd: number | null = null;
  // `looksLikeWrapper` + a trailing `return looksLikeWrapper;`, rather than
  // returning directly from inside `catch` (the `try` above keeps its own
  // direct early `return`): a v8/istanbul coverage-instrumentation artifact
  // for `try { return A } catch { return B } finally {}`, re-derived
  // empirically (see `providers/model-catalog.ts`'s `listProviderModels`,
  // which hit the exact same phantom branch at its own `finally` clause
  // opening and got the same fix) — a minimal repro of this shape leaves an
  // uncoverable phantom branch at the `finally` clause's own opening brace
  // no matter which real path a test drives through. Only `catch` needed to
  // change.
  let looksLikeWrapper: boolean;
  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(64_000);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return /node|@openai\/codex|codex-/i.test(buffer.toString('utf8', 0, bytesRead));
  } catch {
    looksLikeWrapper = false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort close; nothing actionable if it fails.
      }
    }
  }
  return looksLikeWrapper;
}

function safeRealpath(filePath: string): string | null {
  try {
    return realpathSync(filePath);
  } catch {
    return null;
  }
}

function existingDirectories(dirs: string[]): string[] {
  return dirs.filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

function isExecutableFile(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (process.platform !== 'win32') accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
