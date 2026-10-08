import { createMemorySeoApi } from '../../../adapters/memory.js';
import type { AdminSeoPort } from '../../../ports.js';
import type { MemorySeoOptions } from '../../../adapters/memory.js';
import type { SeoSettings, SeoSettingsPatch, SeoEntryMeta, SeoEntryAnalysis, SeoEntryOverridesPatch, AdminPost, AdminMedia } from '../../../models.js';
export type { SeoSettings, SeoSettingsPatch, SeoEntryMeta, SeoEntryAnalysis, SeoEntryOverridesPatch, AdminPost, AdminMedia } from '../../../models.js';
/** Test-only call-shape adapter: assertions and spies retain the source hook ABI. */
export interface SeoPort {
  getSeoSettings(): Promise<{ data: SeoSettings }>;
  setSeoSettings(patch?: SeoSettingsPatch): Promise<{ data: SeoSettings }>;
  regenerateSitemap(): Promise<{ data: { accepted: boolean } }>;
  getSeoEntry(entryId: string): Promise<{ data: SeoEntryMeta }>;
  putSeoEntry(target: { entryId: string }, patch?: SeoEntryOverridesPatch): Promise<{ data: SeoEntryMeta }>;
  getSeoEntryAnalyze(entryId: string): Promise<{ data: SeoEntryAnalysis }>;
  listPosts(): Promise<{ posts: Array<{ post: AdminPost }> }>;
  listPages(): Promise<{ posts: Array<{ post: AdminPost }> }>;
}
export interface SitemapPort { fetchSitemapXml(): Promise<{ text: string }> }
export function createFakeSeoPort(required: MemorySeoOptions = {}): SeoPort {
  const memory = createMemorySeoApi(required);
  return {
    getSeoSettings: async () => ({ data: await memory.getSeoSettings({}) }),
    setSeoSettings: async (patch = {}) => ({ data: await memory.putSeoSettings({}, patch) }),
    regenerateSitemap: async () => ({ data: await memory.regenerateSeoSitemap({}) }),
    getSeoEntry: async entryId => ({ data: await memory.getSeoEntry({ entryId }) }),
    putSeoEntry: async (target, patch = {}) => ({ data: await memory.putSeoEntry(target, patch) }),
    getSeoEntryAnalyze: async entryId => ({ data: await memory.analyzeSeoEntry({ entryId }) }),
    listPosts: async () => ({ posts: (await memory.listSeoPosts({})).map(post => ({ post })) }),
    listPages: async () => ({ posts: (await memory.listSeoPages({})).map(post => ({ post })) }),
  };
}
const adapters = new WeakMap<SeoPort, AdminSeoPort>();
export function coreSeoApi(port: SeoPort): AdminSeoPort {
  const existing = adapters.get(port);
  if (existing) return existing;
  // Late property reads keep a replaced/spied source method observable after a hook mount.
  const adapter: AdminSeoPort = {
    ...createMemorySeoApi({}),
    getSeoSettings: async () => (await port.getSeoSettings()).data,
    putSeoSettings: async (_required, patch) => (await port.setSeoSettings(patch)).data,
    regenerateSeoSitemap: async () => (await port.regenerateSitemap()).data,
    getSeoEntry: async ({ entryId }) => (await port.getSeoEntry(entryId)).data,
    putSeoEntry: async (target, patch) => (await port.putSeoEntry(target, patch)).data,
    analyzeSeoEntry: async ({ entryId }) => (await port.getSeoEntryAnalyze(entryId)).data,
    listSeoPosts: async () => (await port.listPosts()).posts.map(({ post }) => post),
    listSeoPages: async () => (await port.listPages()).posts.map(({ post }) => post),
  };
  adapters.set(port, adapter);
  return adapter;
}
const sitemapAdapters = new WeakMap<SitemapPort, AdminSeoPort>();
export function coreSitemapApi(port: SitemapPort): AdminSeoPort {
  const existing = sitemapAdapters.get(port);
  if (existing) return existing;
  const adapter = { ...createMemorySeoApi({}), fetchSitemapXml: () => port.fetchSitemapXml() };
  sitemapAdapters.set(port, adapter);
  return adapter;
}
export function createFakeSitemapPort({ text, error }: { text?: string; error?: string } = {}): SitemapPort {
  const memory = createMemorySeoApi({ ...(text === undefined ? {} : { sitemapText: text }), ...(error === undefined ? {} : { sitemapError: error }) });
  return { fetchSitemapXml: () => memory.fetchSitemapXml({}) };
}
export function createFakeMediaPickerPort() {
  return { mediaOriginalUrl: (id: string) => `fake://media-picker-original/${encodeURIComponent(id)}` };
}
/** Host-slot fixture API; SEO never imports this test object in production. */
export const api = {
  listMedia: async (): Promise<{ media: AdminMedia[] }> => ({ media: [] }),
  mediaOriginalUrl: (id: string) => `/media/${encodeURIComponent(id)}/original`,
};
