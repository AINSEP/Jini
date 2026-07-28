import { describe, expect, it } from "vitest";

import { execCommandViaLoginShell, execFileBuffered } from "../shell.js";

const isWin32 = process.platform === "win32";

describe("@injini/platform — shell", () => {
  describe("execFileBuffered", () => {
    it("resolves ok:true with trimmed stdout on success", async () => {
      const result = await execFileBuffered(process.execPath, ["-e", "process.stdout.write('  hi  \\n')"]);
      expect(result).toEqual({ code: undefined, error: null, ok: true, stderr: "", stdout: "hi" });
    });

    it("resolves ok:false with the error and trimmed stderr on failure", async () => {
      const result = await execFileBuffered(process.execPath, [
        "-e",
        "process.stderr.write('boom'); process.exit(3)",
      ]);
      expect(result.ok).toBe(false);
      expect(result.stderr).toBe("boom");
      expect(result.error).toBeInstanceOf(Error);
      expect(result.code).toBe(3);
    });

    it("resolves ok:false with code undefined when execFile itself fails to spawn", async () => {
      const result = await execFileBuffered("this-command-does-not-exist-anywhere", []);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.stdout).toBe("");
    });
  });

  describe("execCommandViaLoginShell", () => {
    it.skipIf(isWin32)("re-enters $SHELL -c and preserves PATH for the inner command", async () => {
      const result = await execCommandViaLoginShell(process.execPath, [
        "-e",
        "process.stdout.write(String(!!process.env.PATH))",
      ]);
      expect(result.ok).toBe(true);
      expect(result.stdout).toBe("true");
    });

    it.skipIf(isWin32)("quotes arguments containing single quotes and whitespace safely", async () => {
      const result = await execCommandViaLoginShell(process.execPath, [
        "-e",
        "process.stdout.write(process.argv[1])",
        "it's a test with spaces",
      ]);
      expect(result.ok).toBe(true);
      expect(result.stdout).toBe("it's a test with spaces");
    });

    it.skipIf(isWin32)("falls back to /bin/zsh when SHELL is unset", async () => {
      const previous = process.env.SHELL;
      delete process.env.SHELL;
      try {
        const result = await execCommandViaLoginShell(process.execPath, ["-e", "process.exit(0)"]);
        expect(result.ok).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.SHELL;
        else process.env.SHELL = previous;
      }
    });

    it.skipIf(isWin32)("falls back to /bin/zsh when SHELL is set but blank", async () => {
      const previous = process.env.SHELL;
      process.env.SHELL = "   ";
      try {
        const result = await execCommandViaLoginShell(process.execPath, ["-e", "process.exit(0)"]);
        expect(result.ok).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.SHELL;
        else process.env.SHELL = previous;
      }
    });

    it.skipIf(isWin32)("quotes a missing PATH as an empty string instead of the literal 'undefined'", async () => {
      const previousPath = process.env.PATH;
      delete process.env.PATH;
      try {
        const result = await execCommandViaLoginShell(process.execPath, [
          "-e",
          "process.stdout.write(JSON.stringify(process.env.PATH ?? null))",
        ]);
        expect(result.ok).toBe(true);
        expect(result.stdout).toBe(JSON.stringify(""));
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      }
    });

    it("falls back to execFileBuffered directly on win32", async () => {
      const previousPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });
      try {
        const result = await execCommandViaLoginShell(process.execPath, ["-e", "process.stdout.write('win')"]);
        expect(result.ok).toBe(true);
        expect(result.stdout).toBe("win");
      } finally {
        Object.defineProperty(process, "platform", { value: previousPlatform });
      }
    });
  });
});
