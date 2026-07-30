# Jini Playground — desktop host

This is the Electron shell for the Jini Playground. It composes the real
`@jini-ai/desktop-host` Electron adapter, opens the same renderer as the Chrome host, and
labels the surface with `?shell=desktop` so parity differences remain visible.

From the repository root, `pnpm playground` starts the daemon and web renderer, opens
Chrome, and launches this shell. `pnpm playground:desktop` launches only Electron and
expects the playground web server to already be available at `http://127.0.0.1:4173`.
