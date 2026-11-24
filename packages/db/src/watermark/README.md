# watermark

`kernelStampWatermark` / `readKernelWatermark` / `reconcileMirror` (`@jini-ai/db/watermark/kernel`):
the site write watermark (SPEC-016 C-004/U-002/U-004) on the storage kernel, one Kysely query body for
every dialect. The singleton row (id 1) is advanced by exactly 1 per gated write, inside the caller's
open transaction when there is one.

## Wiring

- The host injects a schema-erased `StorageKernel<Kysely<unknown>, unknown>` and the table name
  (`tables.watermark`); no table name or schema default lives here. The host's table must match the
  structural `WriteWatermarkTable` row slice and its content-store preparation must create the
  singleton row `id = 1` (a missing row reads 0 and a stamp is then a no-op).
- The host's composition root binds `kernelStampWatermark` as the cms write-services'
  `stampWatermark` (which they await), its db-ops adapter stamps restore points with
  `readKernelWatermark`, and boot calls `reconcileMirror` with the host's `MirrorStorePort`
  (structurally `WriteWatermarkMirror`), passing `kernel: null` when the content database failed to open.
