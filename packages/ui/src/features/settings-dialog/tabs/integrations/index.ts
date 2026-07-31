export type {
  CodexInstallStatus,
  McpClientDescriptor,
  McpClientId,
  McpClientSnippet,
  McpInstallInfo,
  McpInstallPlatform,
  McpSnippetLanguage,
  McpStdioServerConfig,
} from '@jini-ai/ui-core';
export { DEFAULT_MCP_CLIENT_ID, DEFAULT_MCP_SERVER_NAME, MCP_CLIENTS } from '@jini-ai/ui-core';
export {
  buildClaudeCliSnippet,
  buildCodexEnvToml,
  buildCodexTomlSnippet,
  buildCursorDeeplink,
  buildMcpStdioServerConfig,
  buildSharedMcpJson,
  buildVsCodeSnippet,
  buildZedSnippet,
  commandPaletteShortcut,
  homeConfigPath,
  methodLabelForClient,
  settingsShortcut,
  snippetForClient,
  utf8Btoa,
} from '@jini-ai/ui-core';
export type { McpIntegrationsPort } from '@jini-ai/ui-core';
export { createFakeMcpIntegrationsPort } from '@jini-ai/ui-core';
export type { FakeMcpIntegrationsPortOptions } from '@jini-ai/ui-core';

export { useMcpInstallInfo, useWiredMcpInstallInfo } from './react/hooks/useMcpInstallInfo.js';
export type { McpInstallInfoController } from './react/hooks/useMcpInstallInfo.js';
export { useCodexInstallToggle, useWiredCodexInstallToggle } from './react/hooks/useCodexInstallToggle.js';
export type { CodexInstallToggleController } from './react/hooks/useCodexInstallToggle.js';
export { ClientPicker } from './react/components/ClientPicker.js';
export type { ClientPickerProps } from './react/components/ClientPicker.js';
export { SnippetBlock } from './react/components/SnippetBlock.js';
export type { SnippetBlockProps } from './react/components/SnippetBlock.js';
export { CodexInstallToggleButton } from './react/components/CodexInstallToggleButton.js';
export type { CodexInstallToggleButtonProps } from './react/components/CodexInstallToggleButton.js';
export { IntegrationsTab } from './react/components/IntegrationsTab.js';
export type { IntegrationsTabProps } from './react/components/IntegrationsTab.js';
