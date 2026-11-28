import { describe, expect, it } from 'vitest';
import * as entry from '../index.js';
import * as rules from '../rules.js';
import * as card from '../SiteCard.js';
import * as listView from '../site-list-view.js';
import * as toolbar from '../SiteListToolbar.js';
import * as cardPreview from '../use-site-card-preview.hooks.js';
import * as createdReturn from '../use-created-site-return.hooks.js';
import * as listPrefs from '../use-site-list-prefs.hooks.js';
import * as listViewHook from '../use-site-list-view.hooks.js';
import * as preview from '../use-site-preview.hooks.js';

/** `index.ts` is the published `./site-card` subpath. */
describe('site-card public entry', () => {
  it('exposes exactly its runtime surface, each bound to the implementing module', () => {
    const expected = {
      SiteCard: card.SiteCard,
      SiteCardStatus: card.SiteCardStatus,
      SiteCardPin: toolbar.SiteCardPin,
      SiteListToolbar: toolbar.SiteListToolbar,
      useSiteListView: listViewHook.useSiteListView,
      DEFAULT_SITE_LIST_PREFS: listView.DEFAULT_SITE_LIST_PREFS,
      parseSiteListPrefs: listView.parseSiteListPrefs,
      useSiteListPrefs: listPrefs.useSiteListPrefs,
      isCardOpenKey: rules.isCardOpenKey,
      cardOpenProps: rules.cardOpenProps,
      closeMenuThen: rules.closeMenuThen,
      duplicateDisplayNames: rules.duplicateDisplayNames,
      useSitePreview: preview.useSitePreview,
      previewFetchPlan: preview.previewFetchPlan,
      nextPreviewUrl: preview.nextPreviewUrl,
      resolveSiteCardPreview: cardPreview.resolveSiteCardPreview,
      useSiteCardPreview: cardPreview.useSiteCardPreview,
      useReturnToSiteListOnCreate: createdReturn.useReturnToSiteListOnCreate,
    };
    expect(Object.keys(entry).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, value] of Object.entries(expected)) {
      expect(value, name).not.toBeUndefined();
      expect(entry[name as keyof typeof entry], name).toBe(value);
    }
  });
});
