/**
 * @file Host-mediated external links: a surface declares the https origins it may link to
 * (`linkOrigins`, parsed in `./descriptor.ts`), and asks the host page to open a URL with an `open-link` message; the host page
 * passes that message to `openAdminSurfaceLink`, which opens it through the host's own opener only
 * when it comes from this mount and names a declared https origin.
 *
 * Why the host opens links: a surface frame is sandboxed without `allow-popups` or top navigation,
 * so it cannot open anything itself, and must not: the host decides HOW (a new tab with `noopener`
 * on the web, the system browser on desktop). Why the gate is this strict: a link the host opens
 * leaves the sandbox entirely, so the destination is limited to what the shipped, digest-checked
 * surfaces file declared, and the opener receives the URL parser's normalized form so it never
 * re-parses a string this gate judged differently.
 */
import { frameTransportRefusal, REQUEST_ID_PATTERN, type AdminSurfaceMessageEvent, type AdminSurfaceMountRecord } from './host-validator.js';
import {
  ADMIN_SURFACE_PROTOCOL, ADMIN_SURFACE_PROTOCOL_VERSION, adminSurfaceActionResponse,
  type AdminSurfaceActionResponse, type AdminSurfaceOpenLinkRequest,
} from './protocol.js';

/** Longer URLs are refused, not cut: a truncated link would open somewhere the plugin did not mean. */
const MAX_LINK_URL_LENGTH = 2048;

/** Host port: opens an already-checked https URL however the host decides (new tab with `noopener`, system browser). */
export type AdminSurfaceOpenLinkPort = (required: { readonly url: string }, optional?: Record<string, never>) => void | Promise<void>;

/** `ignored`: not this mount's open-link message; drop silently. Otherwise post `response` back to the frame. */
export type AdminSurfaceLinkVerdict =
  | { readonly ok: true; readonly url: string; readonly response: AdminSurfaceActionResponse }
  | { readonly ok: false; readonly ignored: string }
  | { readonly ok: false; readonly refused: string; readonly response: AdminSurfaceActionResponse };

function isOpenLinkEnvelope(data: unknown): data is AdminSurfaceOpenLinkRequest {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Readonly<Record<string, unknown>>;
  const isProtocol = message.protocol === ADMIN_SURFACE_PROTOCOL && message.version === ADMIN_SURFACE_PROTOCOL_VERSION && message.kind === 'open-link';
  return isProtocol && typeof message.mountId === 'string' && typeof message.requestId === 'string' && REQUEST_ID_PATTERN.test(message.requestId) && typeof message.url === 'string';
}

type LinkRefusal = { readonly code: string; readonly message: string };

/** The normalized URL when `raw` may be opened, or why not. Messages never echo the URL. @complexity O(n) in the URL length. */
function checkLink(raw: string, origins: readonly string[]): { readonly url: string } | LinkRefusal {
  if (raw.length > MAX_LINK_URL_LENGTH) return { code: 'link-too-long', message: 'The link is too long.' };
  if (!URL.canParse(raw)) return { code: 'link-invalid', message: 'That link is not a valid web address.' };
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') return { code: 'link-not-https', message: 'Only https links can be opened.' };
  // Credentials in a link are a phishing shape (`https://trusted@elsewhere`) and never needed to open a page.
  if (parsed.username !== '' || parsed.password !== '') return { code: 'link-invalid', message: 'That link is not a valid web address.' };
  if (!origins.includes(parsed.origin)) return { code: 'link-undeclared', message: 'This surface did not declare that link destination.' };
  return { url: parsed.href };
}

/**
 * Judges one `message` event as an open-link request for one mount and, when it passes, opens it
 * through the host's port. Pass every message event here as well as to `validateAdminSurfaceMessage`;
 * each ignores the other's messages.
 * @param required.openLink - The host's opener; called at most once, with the normalized URL.
 * @complexity O(n) in the URL length, plus the opener.
 */
export async function openAdminSurfaceLink(
  required: { readonly event: AdminSurfaceMessageEvent; readonly mount: AdminSurfaceMountRecord; readonly openLink: AdminSurfaceOpenLinkPort },
  _optional: Record<string, never> = {},
): Promise<AdminSurfaceLinkVerdict> {
  const { event, mount, openLink } = required;
  const transport = frameTransportRefusal({ event, mount });
  if (transport !== null) return { ok: false, ignored: transport };
  if (!isOpenLinkEnvelope(event.data)) return { ok: false, ignored: 'not-an-open-link' };
  const request = event.data;
  if (request.mountId !== mount.mountId) return { ok: false, ignored: 'mount-mismatch' };
  const refuse = (refusal: LinkRefusal, retryable = false) => ({ ok: false as const, refused: refusal.code, response: adminSurfaceActionResponse({ request, outcome: { ok: false, error: { ...refusal, retryable } } }) });
  const checked = checkLink(request.url, mount.descriptor.linkOrigins ?? []);
  if (!('url' in checked)) return refuse(checked);
  try { await openLink({ url: checked.url }); } catch { return refuse({ code: 'link-failed', message: 'The host could not open the link. Try again.' }, true); }
  return { ok: true, url: checked.url, response: adminSurfaceActionResponse({ request, outcome: { ok: true, result: null } }) };
}
