## Opt-In Tiers

| Tier | Load | Names |
|---|---|---|
| Advanced (experimental, WebGL2 / Canvas / Web Audio, API may change without a major) | `<script src="kuinetic.advanced.js">` beside core, either order; or `registerAdvanced(k)` from `kuinetic/advanced` (or `registerShaders`, `registerScenes`, `registerCamera`, `registerParticles`, `registerFluidCursor`, `registerAudio`). No CSS file. | `shaders` `shader-displace` `shader-fluid` `fluid-pointer` `shader-liquid` `liquid-distort` `shader-particles` `particle-field` `shader-morph` `image-morph` `shader-gradient` `gradient-liquid` `gradient-bands` `gradient-holo` `shader-logo` `logo-gradient`; `scene` `scene-step`; `camera-scene` `camera-layer`; `particle-dissolve`; `fluid-trail` `cursor-fluid` `fluid-cursor`; `audio-source` `audio-reactive` `audio-mic` |
| 3D model | Not published: `src/3d/` is absent from the package `exports` and its renderer is not built. Do not use. | `model-3d` |
| Notes | Optional `kuinetic.notes.js`, only to add plain-words notes to `describe()` output. | none |

Every advanced primitive declares `reducedMotion: 'disable'`. Generative shaders bake one
still frame, `scene` holds its final frame, and `camera-scene` renders a stationary
composition. Source: `src/advanced/index.ts` and its modules,
`docs/advanced-modules.md`, `src/3d/index.ts`.
