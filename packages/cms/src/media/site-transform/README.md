# `@jini-ai/cms/media/site-transform/image-ops`

Pure image operations behind an agent-facing image transform tool: validate output specs, then
resize, crop, rotate, flip and re-encode one source into up to 8 files, ICO included. Bytes in,
bytes out. Rationale for the split lives in
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

**What it needs injected.**
- `imageCodec: ImageCodecPort` (`inspect` / `encode`, from `@jini-ai/cms/media`) on every call that
  decodes: `inspectImage` and `renderOutputs`. The host supplies the adapter (for example one
  backed by `sharp`); this module never imports an image library.
- `source: Buffer`, the original bytes the host already read from its blob store.
- Optional `limits?: Partial<ImageLimits>` to tighten the defaults in `IMAGE_LIMITS`.
- The optional peer `@cfworker/json-schema`, which validates `OUTPUT_SCHEMA`.

**What it provides** (single subpath, no barrel).
- `normalizeOutputs`, `renderOutputs`, `inspectImage`, `encodeIco`
- `OUTPUT_SCHEMA` (a JSON Schema the host can reuse as its tool's input schema), `IMAGE_LIMITS`,
  `IMAGE_FORMATS`, `IMAGE_CONTENT_TYPES`
- `ImageTransformError` and the types `ImageOutput`, `RenderedImage`, `ImageFormat`, `ImageLimits`

It writes nothing. The host decides where each `RenderedImage.path` goes and persists the bytes.

```ts
import { IMAGE_CONTENT_TYPES, ImageTransformError, normalizeOutputs, renderOutputs }
  from "@jini-ai/cms/media/site-transform/image-ops";

try {
  const outputs = normalizeOutputs({ outputs: args.outputs }); // validates before any decode
  const rendered = await renderOutputs({ source: Buffer.from(bytes), outputs, imageCodec });
  for (const { path, bytes: out, format } of rendered) await hostStore.save({ path, bytes: out, contentType: IMAGE_CONTENT_TYPES[format] });
} catch (error) {
  if (error instanceof ImageTransformError) return hostToolRefusal(error.message); // a caller-fixable input
  throw error;
}
```

**Must never import.** Host modules (theme or media tool catalogs, composition roots), a server
framework, a filesystem API, `sharp` directly, or product names. The host's codec adapter is the
only path to pixels.

## Tool registration

`@jini-ai/cms/media/site-transform/tool` composes these operations with injected source readers,
`AssetDestinationKit` from `@jini-ai/cms/asset-transfer/asset-destinations`, and the host's branded
approval handler. The codec is required. Inspection reads and inspects without resolving a destination.
Site and picked-folder outputs use the guarded writer's one prepared batch and approval card; the
same bytes and paths reach the writer after confirmation. Theme outputs use the injected theme writer
and one reload because those edits retain the theme owner's validation and undo behavior.
