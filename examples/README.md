# Jini Examples

This is the public starting point for seeing how Jini is hosted and for exploring safe
projects with an agent.

## Runnable hosts

- [`reference-web/`](reference-web/README.md) — the Jini Playground Vite + React host. It
  connects `@jini-ai/chat-react` to a real local daemon over HTTP and SSE.
- [`reference-desktop/`](reference-desktop/README.md) — the Electron shell around that
  same renderer, composed through `@jini-ai/desktop-host`.

Run both hosts from the repository root:

```sh
pnpm playground
```

## Projects and proofs

- [`sample-projects/`](sample-projects/README.md) — disposable projects a new user can
  safely inspect and modify from the Playground.
- [`minimal-host/`](minimal-host/README.md) — the headless consumer and package-neutrality
  acceptance proof.

Everything here consumes Jini. Publishable engine implementation stays under `packages/`;
internal architecture work, automation, and product adapters stay under `foundry/`.
