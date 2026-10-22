/** Bundle value contracts shared by collection, manifest assembly and host ports. */
export interface MachineInfo {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  type: string;
  totalMemoryBytes: number;
  nodeVersion: string;
  pid: number;
  ppid: number;
  cwd: string;
  username?: string | undefined;
}

export interface CollectedFile {
  name: string;
  absolutePath: string;
  /** Redacted contents to put into the zip. Null when the file could not be read. */
  content: string | null;
  bytes: number;
  /** Reason the file is missing or unreadable. */
  error?: string;
}

