export const agentPluginsMessagesEn = {
  title: 'Agent Plugins', installed: 'Installed', downloaded: 'Downloaded', marketplace: 'Marketplace',
  description: 'Portable packages installed for this workspace.', denied: 'Permission denied',
  loading: 'Loading Agent Plugins…', empty: 'No Agent Plugins are installed in this workspace.',
  loadError: 'Failed to load agent plugins', actionError: 'Failed to update agent plugin',
  fileError: 'Failed to load package files', filesLoading: 'Loading package files…',
  filesEmpty: 'No files to show for this plugin.', filesTruncated: 'Some files are not listed: this package is larger than the viewer’s limits.',
  installedLede: 'Every plugin installed in this workspace. Only switched-on plugins reach the assistant’s prompt.',
  downloadedLede: 'An installed plugin sits inert until you enable it. Enabling one puts its skills in the assistant’s prompt for every run.',
  uninstallUnavailable: 'Uninstall is unavailable in this view. Package removal is managed by the host.',
  marketplaceTitle: 'Nothing to browse yet', marketplaceDescription: 'Marketplace is planned for a future release. This view does not fetch, install, or list marketplace packages yet.',
  marketplaceHint: 'Until then, the Downloaded tab lists the packages available in this workspace.',
} as const;
