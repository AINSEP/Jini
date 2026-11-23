/**
 * @file OS process usage and private-memory sample shapes. Types only; this module owns the
 * declarations that `@jini-ai/platform/process` (`process.ts`) used to declare. That package
 * imports them from here and keeps its runtime values.
 */

/** Display-only usage: RSS is bytes; CPU is cumulative seconds across all cores. */
export type ProcessUsage = {
  pid: number;
  ppid: number;
  rssBytes: number;
  cpuSeconds: number;
  /** Executable basename only; empty when the OS provides no name. */
  name: string;
};

/** Private-memory samples are separate from RSS; unsupported hosts retain null readings. */
export type ProcessPrivateMemory = {
  metric: "physical-footprint" | "private-working-set" | "unavailable";
  readings: Array<{ pid: number; bytes: number | null }>;
};
