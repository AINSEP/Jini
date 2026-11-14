export { sanitizeUntrustedText, stripControlSequences } from './sanitize-untrusted-text.js';
export type { SanitizeTextOptions } from './sanitize-untrusted-text.js';
export { escapeHtml, escapeXml } from "./escape.js";
export { trimChars, trimCharsEnd, trimCharsStart } from "../primitives/trim-chars.js";
export { captureLineTail } from "./line-tail.js";
export { parseDescriptorI18n } from "./descriptor-i18n.js";
export type { DescriptorI18n } from "./descriptor-i18n.js";
export { createTaggedTextSuppressor, emitWithTextSuppressor, possibleTagStart, MAX_CANDIDATE_LENGTH } from './tagged-text-suppression.js';
export type { TaggedTextMatchers, TaggedTextSuppressor, ArtifactTextSuppressor, ArtifactTextSuppressorStats, StreamTextEvent, StreamEventSink } from './tagged-text-suppression.js';
