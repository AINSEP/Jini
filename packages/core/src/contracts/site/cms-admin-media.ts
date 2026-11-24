/**
 * @file Admin media wire contract: the JSON shape the media REST surface serializes for one asset and
 * that every admin media/library screen reads. Lives in Core so the server route, the admin client
 * and the Jini admin screens share one declaration.
 */

import type { AdminMediaDto } from "./cms-media.js";

/**
 * One asset as the admin API answers it — the server's wire shape, declared once in Core
 * (`AdminMediaDto`, rv1123e K1); the `@jini-ai/cms` serializer answers exactly it, so the client no
 * longer restates its fields (see `AdminMediaDto` for each field's doc: `slug`, `htmlAttributes` — a
 * stored-XSS boundary the server re-validates on write and render — `contentType` — `null` means
 * unreadable bytes, kept on the All tab — and `publicUrl`).
 *
 * Client-only difference: five fields stay OPTIONAL here because legacy servers omit them —
 * `kind` (absent means ordinary media; `"document"` is a private Library document), `originalFilename`
 * (a document's immutable upload filename, `null` for media) and `displayFilename` (a document's
 * display name: the editable `title` plus the original extension), `byteSize` (original blob bytes;
 * `null` when unavailable) and the read-only `createdBy` (acting principal at creation).
 *
 * Two field notes that live only here: `width`/`height`/`cssClass` are a quick-and-dirty public-render
 * sizing override (owner-directed skip-the-ADR fix) where `null` means "not set" — the public renderer
 * omits the corresponding `<img>` attribute rather than rendering `0` or a computed default — and
 * `publicUrl` is NOT the admin's own authenticated `mediaOriginalUrl` preview URL, which is an
 * admin-only route; it is the URL the Media edit panel shows and copies.
 */
export type AdminMedia = Omit<AdminMediaDto, AdminMediaLegacyOptionalField> & Partial<Pick<AdminMediaDto, AdminMediaLegacyOptionalField>>;

/** The {@link AdminMedia} fields a legacy server may omit. */
type AdminMediaLegacyOptionalField = "kind" | "originalFilename" | "displayFilename" | "byteSize" | "createdBy";
