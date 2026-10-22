import { createHash, randomBytes } from "node:crypto";
import type { SessionTokenPort } from "../core/runtime-ports.js";

/** Node adapter retaining the existing 32-byte hex bearer and SHA-256 storage digest. */
export class NodeSessionTokens implements SessionTokenPort {
  constructor(_required: Record<string, never>) {}

  newToken(_required: Record<string, never>): string {
    return randomBytes(32).toString("hex");
  }

  hashToken({ rawToken }: { rawToken: string }): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }
}
