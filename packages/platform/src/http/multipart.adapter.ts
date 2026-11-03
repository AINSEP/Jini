/** Bounded multipart controls decoded by the installed Web Request implementation. */
// Node's bundled parser can turn filename="" into a text control, losing upload identity.
// The installed Undici parser distinguishes absent filenames from empty ones (filename !== null).
import { Request, type FormData } from "undici";
type FormEntryValue = ReturnType<FormData["getAll"]>[number];
type FormFileValue = { filename: string; contentType: string; bytes: Uint8Array };

/** The browser's empty file picker (no filename, no bytes) is not a successful control. */
const isEmptyFilePicker = (raw: FormEntryValue): boolean => typeof raw !== "string" && raw.name === "" && raw.size === 0;

async function toFormValue(raw: FormEntryValue): Promise<string | FormFileValue> {
  return typeof raw === "string" ? raw : { filename: raw.name, contentType: raw.type, bytes: new Uint8Array(await raw.arrayBuffer()) };
}

/** Adds one control, turning a repeated name into an array of values in submission order. */
function appendControl({ body, name, value }: { body: Record<string, unknown>; name: string; value: unknown }): void {
  if (!Object.hasOwn(body, name)) { body[name] = value; return; }
  const existing = body[name];
  // This array belongs to this parse only; append without quadratic repeated copies.
  if (Array.isArray(existing)) existing.push(value);
  else body[name] = [existing, value];
}

/** Decodes bounded multipart bytes into successful controls, preserving repeated choice names.
 * @param required - Buffered request bytes and the multipart Content-Type including its boundary.
 * @param options - Positive integer byte/control caps; defaults to 12 MiB and 2000 controls.
 * @returns A null-prototype body; repeated names become arrays, empty file pickers are omitted.
 * @throws RangeError for invalid limits, oversized bodies or too many controls; parser errors propagate.
 * @example await parseFormMultipart({ bytes, contentType }, { maxBytes: 1024, maxControls: 10 });
 * @complexity O(b + c) time and space for bounded body bytes b and controls c; no network I/O. */
export async function parseFormMultipart(
  { bytes, contentType }: { bytes: Uint8Array; contentType: string },
  { maxBytes = 12 * 1024 * 1024, maxControls = 2000 }: { maxBytes?: number; maxControls?: number } = {},
): Promise<Record<string, unknown>> {
  validateLimits({ maxBytes, maxControls });
  if (bytes.byteLength > maxBytes) throw new RangeError(`form upload exceeds ${maxBytes / (1024 * 1024)} MB`);
  const request = new Request("https://form.invalid/", { method: "POST", headers: { "content-type": contentType }, body: Buffer.from(bytes) });
  const data = await request.formData();
  const body: Record<string, unknown> = Object.create(null);
  let count = 0;
  for (const [name, raw] of data.entries()) {
    count += 1;
    if (count > maxControls) throw new RangeError("too many form controls");
    if (!isEmptyFilePicker(raw)) appendControl({ body, name, value: await toFormValue(raw) });
  }
  return body;
}

/** Reject invalid host configuration before allocating a parsed form. */
function validateLimits({ maxBytes, maxControls }: { maxBytes: number; maxControls: number }): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive safe integer");
  if (!Number.isSafeInteger(maxControls) || maxControls <= 0) throw new RangeError("maxControls must be a positive safe integer");
}
