/**
 * @module redact-vendor-shapes
 *
 * Vendor key shapes the shared catalog (`SECRET_SHAPE_PATTERNS`, written for a static scan of committed
 * files) does not cover at the lengths a pasted or echoed key really has. They carry the categories the
 * engine already generates, so a second pass keeps their markers. Plain data: no I/O, no host state.
 */
import type { SecretRedactionPattern } from './redact.js';

export const VENDOR_SHAPE_PATTERNS: readonly SecretRedactionPattern[] = [
  // A payment provider's webhook signing secret: `whsec_` plus 24 or more alphanumerics.
  { name: 'stripe_key', regex: /(?<!\w)whsec_[A-Za-z0-9]{24,}/g },
  // The built-in GitHub rule asks for 36+ characters and the catalog entries for exactly 36, so a
  // token echoed with 30-35 does not reach them; 30 is the shortest a real token can be.
  { name: 'github_token', regex: /(?<!\w)gh[pousr]_[A-Za-z0-9]{30,}/g },
  // Temporary (STS) access key ids: the catalog and the built-in AWS rule only know the AKIA prefix. The
  // boundaries are the AKIA rule's own, so a key id glued to a word (`xASIA...`, `_ASIA...`) is masked like
  // the permanent one.
  { name: 'aws_access_key', regex: /(?<![0-9A-Z])ASIA[0-9A-Z]{16}(?![0-9A-Z])/g },
];
