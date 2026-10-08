import { useMemo } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createSitemapController } from '../../controllers/sitemap.controller.js';
import { parseSitemapXml, filterSitemapEntries } from '../../rules.js';
import type { SitemapModalController, SitemapModalInputs, SitemapState } from '../../models.js';
import type { AdminSeoPort } from '../../ports.js';
import { useSeoPorts } from './SeoPorts.hooks.js';
export type { SitemapModalController, SitemapModalInputs } from '../../models.js';
export function useSitemapModal({ api, enabled }: { api: AdminSeoPort; enabled: boolean; onClose?: () => void }, _optional: Record<string, never> = {}): SitemapModalController {
  const { controller, snapshot } = useController({ create: () => createSitemapController({ api, enabled }), dependencies: [api, enabled] }, { start: ({ controller }) => { void controller.load({}); } });
  const state: SitemapState = snapshot ?? { status: enabled ? 'loading' : 'disabled', error: null, xmlText: '', filter: '', view: 'table' };
  // Parse only when text/status changes, never on each filter keystroke.
  const entries = useMemo(() => state.status === 'ready' ? parseSitemapXml({ xmlText: state.xmlText }) : [], [state.status, state.xmlText]);
  const filteredEntries = useMemo(() => filterSitemapEntries({ entries, query: state.filter }), [entries, state.filter]);
  return { ...state, entries, filteredEntries, setFilter: value => controller?.setFilter({ value }), setView: view => controller?.setView({ view }), refetch: () => { void controller?.load({}); } };
}
export function useWiredSitemapModal({ enabled, onClose }: SitemapModalInputs, _optional: Record<string, never> = {}): SitemapModalController {
  const { seoApi: api } = useSeoPorts();
  return useSitemapModal({ api, enabled, onClose });
}
