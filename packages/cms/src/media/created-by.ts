import type { MediaRecord } from "./types.js";
import type { MediaRepoPort } from "./ports.js";

/** Bind creation writes to one authenticated caller without shared mutable actor state.
 * Useful when adapting an older upload service that predates asset-level attribution. */
export function mediaRepoWithCreator(required: { mediaRepo: MediaRepoPort; principalId: string },
  _optional: Record<string, never> = {}): MediaRepoPort {
  const { mediaRepo, principalId } = required;
  return {
    findById: input => mediaRepo.findById(input),
    findBySlug: input => mediaRepo.findBySlug(input),
    list: input => mediaRepo.list(input),
    remove: input => mediaRepo.remove(input),
    save: record => mediaRepo.save({ ...record, createdBy: principalId }),
  };
}

/** An update retains creation attribution, privacy kind and the immutable original filename.
 * Kind cannot be downgraded through metadata writes; legacy unknown attribution remains unknown.
 * Omitting an unknown field preserves compatibility with legacy serialized records. */
export function preserveMediaCreator(required: { record: MediaRecord; original: MediaRecord },
  _optional: Record<string, never> = {}): MediaRecord {
  const { createdBy: _ignored, kind: _kind, originalFilename: _filename, ...metadata } = required.record;
  return { ...metadata, ...(required.original.kind !== undefined ? { kind: required.original.kind } : {}),
    ...(required.original.originalFilename !== undefined ? { originalFilename: required.original.originalFilename } : {}), ...(required.original.createdBy !== undefined
    ? { createdBy: required.original.createdBy } : {}) };
}
