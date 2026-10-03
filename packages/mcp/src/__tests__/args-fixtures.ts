import type { McpToolServerRequiredArgs, McpToolServerOptions } from '../server/tool-server.js';
import type { BuildMcpInstallPayloadInputs, BuildMcpInstallPayloadOptions } from '../core/install-info.js';
import type { CreateExecuteDelegatedToolToolRequiredArgs, CreateExecuteDelegatedToolToolOptions } from '../server/tools/delegated-tool.js';

// Keep legacy behavior fixtures intact while passing only required fields in argument one.
export function splitServerFixture(fixture: McpToolServerRequiredArgs & McpToolServerOptions): [McpToolServerRequiredArgs, McpToolServerOptions] {
  const { name, version, tools, resolveBaseUrl, ...options } = fixture;
  return [{ name, version, tools, resolveBaseUrl }, options];
}
export function splitInstallFixture(fixture: BuildMcpInstallPayloadInputs & BuildMcpInstallPayloadOptions): [BuildMcpInstallPayloadInputs, BuildMcpInstallPayloadOptions] {
  const { webBaseUrl, subcommand, ...required } = fixture;
  return [required, { ...(webBaseUrl === undefined ? {} : { webBaseUrl }), ...(subcommand === undefined ? {} : { subcommand }) }];
}
export function splitGatewayFixture(fixture: CreateExecuteDelegatedToolToolRequiredArgs & CreateExecuteDelegatedToolToolOptions): [CreateExecuteDelegatedToolToolRequiredArgs, CreateExecuteDelegatedToolToolOptions] {
  const { runId, ...options } = fixture;
  return [{ runId }, options];
}
