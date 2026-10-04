import { adminPort } from '../core/module/token.js';
import type {
  MediaAsset,
  MediaQuery,
  UploadInput,
  MediaMetadataPatch,
  MediaRequestOptions,
  MediaProvider,
  MediaProviderOption,
  MediaProviderConfigurationMap,
} from './models.js';
/** One shared port rather than one per hook — all three hooks read/write the same
 * resource, and a test double for one is a test double for the resource, not for a single screen.
 * Every synchronous URL builder goes through its consumer's port uniformly, so a test can
 * prove a URL came from the injected port rather than the consumer calling the client itself. */
export interface MediaApiPort {
  readonly replaceSupported?: boolean;
  readonly restoreSupported?: boolean;
  list(required: MediaQuery, optional?: MediaRequestOptions): Promise<readonly MediaAsset[]>;
  upload(
    required: UploadInput,
    optional?: MediaRequestOptions & MediaMetadataPatch,
  ): Promise<MediaAsset>;
  update(
    required: { id: string; patch: MediaMetadataPatch },
    optional?: MediaRequestOptions,
  ): Promise<MediaAsset>;
  /** Optional: replacement preserves identity and references; never upload then trash. */
  replace?(
    required: { id: string; upload: UploadInput },
    optional?: MediaRequestOptions,
  ): Promise<MediaAsset>;
  trash(required: { id: string }, optional?: MediaRequestOptions): Promise<MediaAsset>;
  /** Optional reversible recovery. Absence or explicit disable must hide the action. */
  restore?(required: { id: string }, optional?: MediaRequestOptions): Promise<MediaAsset>;
  /** Genuine irreversible purge; requires a previously trashed asset. No undo affordance. */
  delete(required: { id: string }, optional?: MediaRequestOptions): Promise<{ purged: boolean }>;
  originalUrl(required: { id: string; version?: number }, optional?: Record<string, never>): string;
}
export interface MediaProvidersPort {
  /** Host-owned vendor metadata, available even when the credential service is unreachable. */
  readonly catalog?: readonly MediaProviderOption[];
  readonly pinnedProviderIds?: readonly string[];
  /** One serialized whole-set save. Omission removes an entry; blank keys retain stored keys.
   * Hosts preserve providers outside their catalog and return only public markers. */
  saveChanges?(
    required: { providers: MediaProviderConfigurationMap },
    optional?: MediaRequestOptions,
  ): Promise<readonly MediaProvider[]>;
  /** null leaves local edits untouched, while [] is a real answer that can legitimately
   * drop stale local markers. Collapsing an unreachable server to [] would make a transient
   * network blip read as "the server manages nothing" and wipe edits only null protects. */
  list(
    required: Record<string, never>,
    optional?: MediaRequestOptions,
  ): Promise<readonly MediaProvider[] | null>;
  /** Optional endpoint/model configuration, without credential material. */
  saveSettings?(
    required: { id: string; baseUrl: string; model: string },
    optional?: MediaRequestOptions,
  ): Promise<MediaProvider>;
  /** Never returns secrets. The server owns credential storage, validation and authorization. */
  saveCredential(
    required: { id: string; credential: string },
    optional?: MediaRequestOptions,
  ): Promise<MediaProvider>;
  removeCredential(
    required: { id: string },
    optional?: MediaRequestOptions,
  ): Promise<MediaProvider>;
}
export const mediaApiToken = adminPort<MediaApiPort, 'admin.media.api'>({ id: 'admin.media.api' });
export const mediaProvidersToken = adminPort<MediaProvidersPort, 'admin.media.providers'>({
  id: 'admin.media.providers',
});

/** A host refresh carries no rows; the controller rereads through its own authorized API. */
export interface MediaEventsPort {
  subscribe(required: { onRefresh: () => void }, optional?: Record<string, never>): () => void;
}
export const mediaEventsToken = adminPort<MediaEventsPort, 'admin.media.events'>({ id: 'admin.media.events' });
