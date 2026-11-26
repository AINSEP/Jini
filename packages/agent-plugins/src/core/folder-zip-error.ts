export class FolderZipError extends Error {
  constructor(readonly reason: "empty" | "too-large" | "too-many" | "unreadable", message: string) { super(message); }
}

