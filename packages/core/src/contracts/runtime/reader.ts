import type { DenyRules, GuardedFileReader, GuardedReaderLimits } from "../../filesystem.js";

export interface GuardedReaderPort {
  createReader(required: { rootPath: string; denyRules: DenyRules; limits: GuardedReaderLimits }, optional?: { excludedListingDirs?: ReadonlySet<string> }): GuardedFileReader;
}
