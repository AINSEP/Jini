/** Narrow env-text transforms: first exact KEY= match, preserve unrelated lines, one final newline. */
export function upsertEnvLine({ source, key, value }: { source: string; key: string; value: string }): string {
  const lines = source.length === 0 ? [] : source.split("\n");

  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  const newLine = `${prefix}${value}`;
  if (index === -1) {
    lines.push(newLine);
  } else {
    lines[index] = newLine;
  }
  return `${lines.join("\n")}\n`;
}

export function readEnvLine({ source, key }: { source: string; key: string }): string | null {
  const prefix = `${key}=`;
  const match = source.split("\n").find((line) => line.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length).trim();
}
