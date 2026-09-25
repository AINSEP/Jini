/**
 * @file POSIX single-quote escaping for command arguments.
 *
 * Purpose:
 * E2B's `commands.run` takes one command string, not an argv array, so `runCommand`/
 * `startProcess`/`installDependencies` have to assemble `command + ' ' + args` themselves. A
 * naive join breaks the moment an argument contains a space or a shell metacharacter — exactly
 * the kind of input an AI-generated `npm install <package>` call can produce (scoped package
 * names are fine, but a stray `&&` or unescaped quote in a generated argument is not). Wrapping
 * every argument in single quotes and escaping embedded single quotes is the standard POSIX
 * technique that survives that case: nothing between single quotes is interpreted by the shell
 * except the quote character itself.
 */

/** Wraps `value` in single quotes for safe interpolation into a POSIX shell command, escaping
 *  any single quotes it already contains. The command name itself is not quoted by callers —
 *  only arguments — since it is expected to be a trusted program name, not caller-controlled
 *  data. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
