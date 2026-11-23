/**
 * @file The worker-sandbox render outcome. Types only.
 *
 * Additive copy of the declaration in `@jini-ai/sandbox/node-worker`, which keeps its identical
 * declaration and export until the paired cutover. The worker factory, scheduler and
 * `renderInWorkerSandbox` stay in the sandbox package.
 */

export type SandboxRenderResult = { ok: true; html: string } | { ok: false; error: string };
