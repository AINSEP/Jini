export const CONNECTOR_AUTH_PENDING_STORAGE_KEY = 'jini-connectors-authorization-pending';
export const CONNECTOR_AUTH_PENDING_POLL_MS = 2_000;
export const CONNECTOR_TOOL_PREVIEW_LIMIT = 50;
export const AUTHORIZATION_CANCEL_FAILED_MESSAGE = "Couldn't cancel authorization. Try again.";
export const CONNECTOR_AUTH_CONTINUE_LABEL = 'Continue in browser';

/**
 * Default single-tab provider config, kept only so the feature renders
 * something sensible out of the box. A real host supplies its own
 * `providerTabs` prop — see `ConnectorsBrowserProps`. Per the canary plan,
 * the ~90-entry Composio category->i18n label map was dropped as OD-specific
 * data; a host supplies its own `getCategoryLabel`.
 */
export const DEFAULT_PROVIDER_TABS = [
  {
    id: 'default',
    label: 'All',
    match: () => true,
  },
];

export const DEFAULT_PROVIDER_TAB_ID = 'default';
