import { MediaConflictError, type MediaRecord } from './types.js';
import type { AssetRenditionRepoPort } from './ports.js';
import type { MediaFileReplacementRepoPort } from './replace-media-file.js';

/** Rendition persistence adapter carrying the source precondition through generation.
 * Generation awaits real pixel/blob work. The source may be replaced during those awaits;
 * only an atomic source comparison at persistence prevents a late, obsolete preview. */
export function guardMediaRenditionRepo({ mediaRepo, renditionRepo, media }: {
  mediaRepo: MediaFileReplacementRepoPort; renditionRepo: AssetRenditionRepoPort; media: MediaRecord | null;
}, _options = {}): AssetRenditionRepoPort {
  // A repository that cannot replace sources keeps its existing immutable-source behavior.
  if (!media || !mediaRepo.replaceFileIfVersion) return renditionRepo;
  return {
    findOne(required) { return renditionRepo.findOne(required); },
    listByAsset(required) { return renditionRepo.listByAsset(required); },
    removeByAsset(required) { return renditionRepo.removeByAsset(required); },
    async save(record) {
      if (record.workspaceId !== media.workspaceId || record.assetId !== media.id ||
        !mediaRepo.saveRenditionIfSource ||
        !(await mediaRepo.saveRenditionIfSource({ record, sourceSha256: media.source.sha256 })).applied) {
        throw new MediaConflictError({ message: 'media file changed while generating its preview' });
      }
    },
  };
}
