import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** external-mcp registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "external_mcp_get_admissions": {
    search: {
      keywords: "external mcp admissions admitted refused missing configured tools live roster assistant running actual allowlisted blocked failures",
      queries: [
        "Show external MCP admissions from the running assistant.",
        "Which external MCP tools were actually admitted?",
        "Why are configured MCP tools missing from the live roster?",
        "Which external MCP tools did the assistant refuse?",
        "I allowed tools in Settings but the assistant cannot use them; show configuration failures.",
      ],
    },
    // Starting server federation may refresh a stored OAuth grant, like the probe below.
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "external_mcp_list": {
    search: {
      keywords: "mcp server servers external tool tools integration integrations connected connections configured list existing model context protocol third-party ai",
      queries: [
        "Which external MCP servers are configured and enabled?",
        "Show the status of my connected external MCP servers.",
        "What external MCP integrations have I already set up?",
        "List saved MCP servers and their OAuth connection status.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "external_mcp_oauth_connect": {
    search: {
      keywords: "connect sign in log in authorize authorization oauth account link external tool server integration mcp",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "external_mcp_oauth_poll_device": {
    search: {
      keywords: "check status finished done connected ready oauth device code sign in external tool server mcp waiting",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // --- external mcp (agent tool servers) ----------------------------------------------------------------
  // Operators ask to connect another AI tool/service without knowing MCP transport terminology.
  "external_mcp_probe_connection": {
    search: {
      keywords: "probe hosted remote endpoint live reachability advertised tools external mcp server connection test working check diagnose",
      queries: [
        "Probe my hosted MCP server and show its advertised tools.",
        "Test live external MCP reachability.",
        "List tools advertised by my remote MCP server.",
        "Check my hosted MCP endpoint connection.",
        "Can the assistant reach this saved remote MCP server right now?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "external_mcp_reauth_prompt": {
    approval: { class: 'read', confirmation: 'direct' },
    mcpUi: { redeemable: true },
  },
  "external_mcp_save": {
    search: {
      keywords: "connect add new save external tool server integration mcp hook up set up configure model context protocol third-party ai update edit change existing",
      queries: [
        "Add an MCP server for a new integration.",
        "Configure an external MCP server with a credential form.",
        "Change my existing external MCP server settings.",
        "Connect a new external MCP integration securely.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct', input: 'human-form' },
    mcpUi: { secretField: { secret: true } },
  },
  "external_mcp_test_connection": {
    search: {
      keywords: "test check connection working works verify diagnose troubleshoot external tool server integration mcp",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
