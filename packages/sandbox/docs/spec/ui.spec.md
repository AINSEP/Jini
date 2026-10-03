Spec ID: SPEC-JINI-SANDBOX-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:17933de232e564f025f1aeae1d5274d55ec2a6ddf1a140b4fc82d2d1bbdcf55b
spec_mode: reverse_spec


# UI Contract: optional sandbox starter

## Surface

The execution APIs contain no components, slots or UI lifecycle. `./e2b` exports `DEFAULT_VITE_REACT_TEMPLATE` as eight file records; mounting them is explicit and does not install dependencies or start a server.

The starter supplies a React placeholder using Vite and Tailwind: `package.json`, Vite/Tailwind/PostCSS configs, `index.html`, `src/main.jsx`, `src/App.jsx`, and `src/index.css`. HTML uses `lang="en"`, UTF-8 and viewport metadata; React mounts a text-only placeholder in `#root` under StrictMode.

## Styling and accessibility boundary

The placeholder uses Tailwind utility classes and a system font stack on a dark background. There are no public theming variables, component props, extension slots or interactive controls. The consumer replaces these files to provide its own layout, localization, keyboard behavior, landmarks and accessibility guarantees. Terminal output and preview embedding are consumer UI responsibilities.

Vite starter settings bind `0.0.0.0:5173`, enable strict port, disable HMR and allow the listed hosted-sandbox domains plus localhost. These are starter data, not invariants imposed on every `SandboxSession`.

Source: [starter files](../../src/e2b/default-vite-react-template.ts). No additional UI entry point exists.
