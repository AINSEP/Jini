/**
 * @module defs/index
 *
 * Barrel for the declarative per-CLI `RuntimeAgentDef` catalog: one file
 * per supported coding-agent CLI, plus AMR/Vela model-parsing helpers and
 * Antigravity's model-lock file. Ported from OD's
 * `apps/daemon/src/runtimes/defs/index.ts`.
 */
export * from './aider.js';
export * from './amp.js';
export * from './amr.js';
export * from './antigravity.js';
export * from './claude.js';
export * from './cline.js';
export * from './codebuddy.js';
export * from './codex.js';
export * from './copilot.js';
export * from './cursor-agent.js';
export * from './gemini.js';
export * from './deepseek.js';
export * from './devin.js';
export * from './goose.js';
export * from './grok-build.js';
export * from './hermes.js';
export * from './kilo.js';
export * from './kimi.js';
export * from './kiro.js';
export * from './mimo.js';
export * from './opencode.js';
export * from './pi.js';
export * from './qoder.js';
export * from './qwen.js';
export * from './reasonix.js';
export * from './trae-cli.js';
export * from './vibe.js';
