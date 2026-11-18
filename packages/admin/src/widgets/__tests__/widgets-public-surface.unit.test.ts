import { describe, expect, it } from 'vitest';
import * as surface from '../index.js';

describe('@jini-ai/admin/widgets public surface', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(surface).sort()).toEqual([
      'WIDGETS_LIBRARY_RESOURCE',
      'WIDGETS_REGIONS_RESOURCE',
      'buildDraftPlacement',
      'createWidgetInstanceEditorController',
      'createWidgetRegionEditorController',
      'createWidgetRegionsController',
      'createWidgetsLibraryController',
      'isKnownWidgetType',
      'movePlacement',
      'resolveEditorWidgetType',
      'resolveWidgetRegionSaveError',
      'resolveWidgetSaveError',
      'widgetApiError',
      'widgetConfigFieldErrors',
      'widgetEditorGate',
      'widgetEntityKey',
      'widgetInstanceGuard',
      'widgetSlugRedirectPath',
      'widgetTypeLabel',
      'widgetsAgentPageIds',
      'widgetsApiToken',
      'widgetsEditorPaths',
      'widgetsEnglish',
      'widgetsEventsToken',
      'widgetsMessagesEn',
      'widgetsModule',
      'widgetsNavigationToken',
    ]);
  });
});
