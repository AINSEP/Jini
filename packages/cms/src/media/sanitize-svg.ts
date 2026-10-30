import { sniffContentType } from "./content-type-sniffer.js";
import { MediaValidationError } from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const LOCAL_REFERENCE = /^#[a-z_][\w:.-]*$/i;
const RASTER_DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-z\d+/=\s]+)$/i;

function isRasterDataImage(value: string): boolean {
  const match = RASTER_DATA_IMAGE.exec(value);
  return match !== null && sniffContentType({ bytes: Buffer.from(match[2]!, "base64") }) === match[1]!.toLowerCase();
}

// DOMPurify does not sanitize CSS. Keep ordinary logo styles and local paint servers, but
// discard escaped/comment-obfuscated CSS, at-rules, and every non-document URL.
function hasUnsafeCss(value: string): boolean {
  const withoutLocalUrls = value.replace(/url\(\s*(["']?)(#[a-z_][\w:.-]*)\1\s*\)/gi, "");
  return /[\\@]|\/\*|(?:url|(?:-webkit-)?image-set|src|expression)\s*\(/i.test(withoutLocalUrls);
}

async function createRuntime() {
  // Load the DOM only for SVG; ordinary image uploads keep their existing lightweight path.
  const [{ JSDOM }, { default: createDOMPurify }] = await Promise.all([import("jsdom"), import("dompurify")]);
  const window = new JSDOM("").window;
  const purifier = createDOMPurify(window);
  purifier.addHook("uponSanitizeElement", (node) => {
    // A node named "style" is an Element, and an Element's textContent is always a string (the DOM
    // returns null only for Document/DocumentType), so no null fallback is needed here.
    if (node.nodeName.toLowerCase() === "style" && hasUnsafeCss(node.textContent as string)) node.textContent = "";
  });
  purifier.addHook("uponSanitizeAttribute", (node, attribute) => {
    const name = attribute.attrName.toLowerCase();
    const value = attribute.attrValue.trim();
    if (name.startsWith("on") || name === "xml:base" || hasUnsafeCss(value)) attribute.keepAttr = false;
    if (name === "href" || name === "xlink:href" || name === "src") {
      attribute.keepAttr = LOCAL_REFERENCE.test(value) ||
        (node.nodeName.toLowerCase() === "image" && isRasterDataImage(value));
    }
  });
  return { window, purifier };
}

let runtime: ReturnType<typeof createRuntime> | undefined;

/** Sanitizes a standalone SVG before hashing/storage or inline serving, including legacy blobs.
 * Rejects malformed XML, DTDs/entities and SVG fonts. No scripts or external resources are loaded.
 * @complexity O(n) in the size-bounded SVG document.
 */
export async function sanitizeSvg(
  { bytes }: { bytes: Uint8Array },
  _options: Record<string, never> = {}
): Promise<Uint8Array> {
  runtime ??= createRuntime();
  const { window, purifier } = await runtime;
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MediaValidationError({ message: "SVG must be valid UTF-8" });
  }
  // Reject before XML parsing: no external entities, SVG font documents, or DTD expansion.
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new MediaValidationError({ message: "SVG DTDs and entities are not allowed" });
  const document = new window.DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (document.querySelector("parsererror") || root.localName !== "svg" || root.namespaceURI !== SVG_NAMESPACE) {
    throw new MediaValidationError({ message: "invalid SVG document" });
  }
  if ([...document.getElementsByTagName("*")].some((element) => ["font", "font-face"].includes(element.localName.toLowerCase()))) {
    throw new MediaValidationError({ message: "SVG fonts are not allowed" });
  }
  purifier.sanitize(root, {
    IN_PLACE: true,
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"],
    // Animation can rewrite a safe reference after sanitization. Foreign HTML is never media.
    FORBID_TAGS: ["script", "foreignObject", "animate", "animateMotion", "animateTransform", "set", "discard"],
    FORBID_ATTR: ["xml:base"],
    ALLOW_DATA_ATTR: false,
  });
  return new TextEncoder().encode(new window.XMLSerializer().serializeToString(root));
}
