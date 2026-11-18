import { describe, expect, it } from 'vitest';
import * as seo from '../index.js';

describe('@jini-ai/admin/seo public surface', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(seo).sort()).toEqual([
      'SEO_TAB_IDS',
      'actionLabel',
      'buildMediaRef',
      'buildSeoSettingsPatch',
      'createEntryPickerController',
      'createMediaRefController',
      'createSeoController',
      'createSeoEntryController',
      'createSeoEntrySectionController',
      'createSitemapController',
      'describeMediaRef',
      'describeSeoError',
      'entryPickerOptions',
      'filterSitemapEntries',
      'inheritedXFor',
      'initialEntryPickerState',
      'initialSeoEntryState',
      'initialSeoState',
      'isStoredMediaRef',
      'ogImageInherited',
      'orEmpty',
      'overrideOrClear',
      'parseSitemapXml',
      'resolveMediaRefPreviewUrl',
      'resolveSeoTabId',
      'scoreTone',
      'seoApiToken',
      'seoEventsToken',
      'seoMessagesEn',
      'seoModule',
      'shareImageWarning',
      'sortIssuesBySeverity',
      'xIsCustomized',
      'xResolvedValue',
    ]);
  });
});
