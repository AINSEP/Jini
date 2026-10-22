import type { MediaAsset as PickerAsset } from '../contracts/media-picker.js';
export interface MediaAsset extends PickerAsset {
  /** Optional for hosts without CMS metadata; blank dimensions mean native size, never inferred. */
  readonly slug?: string;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly cssClass?: string | null;
  readonly htmlAttributes?: string | null;
  readonly byteSize?: number;
  readonly status: 'active' | 'trashed';
  readonly sha256: string;
  readonly caption: string;
  readonly credit: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}
export type MediaTabId = 'all' | 'images' | 'videos' | 'external-providers';
export type MediaContentTabId = Exclude<MediaTabId, 'external-providers'>;
export type MediaOrderBy = 'created' | 'alphabetical';
export interface MediaQuery {
  /** All retains the legacy mixed library; Trash is an explicit status filter. */
  readonly status?: 'active' | 'trashed';
  readonly filter?: MediaContentTabId;
  readonly search?: string;
  readonly orderBy?: MediaOrderBy;
}
export interface UploadInput {
  readonly filename: string;
  readonly contentType: string;
  readonly dataBase64: string;
}
export interface MediaMetadataPatch {
  /** Independent of title; clearing a title must never rewrite a readable reference. */
  readonly slug?: string;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly cssClass?: string | null;
  readonly htmlAttributes?: string | null;
  readonly title?: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly credit?: string;
}
export interface MediaRequestOptions {
  readonly signal?: AbortSignal;
}
export interface MediaProvider {
  readonly id: string;
  readonly label: string;
  readonly configured: boolean;
  readonly baseUrl?: string;
  readonly model?: string;
  /** A display-only tail, never recoverable credential material. */
  readonly apiKeyTail?: string;
}
export interface MediaProviderOption {
  readonly id: string;
  readonly label: string;
  readonly defaultBaseUrl?: string;
  readonly models?: readonly string[];
}
/** Only operator-entered keys travel to the host; reads return markers and tails. */
export interface MediaProviderConfiguration {
  apiKey?: string;
  apiKeyConfigured?: boolean;
  apiKeyTail?: string;
  baseUrl?: string;
  model?: string;
}
export type MediaProviderConfigurationMap = Record<string, MediaProviderConfiguration>;
