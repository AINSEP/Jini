import { describe, expect, it } from 'vitest';
// Reached by relative path on purpose. `connection-guard.ts` has ZERO imports —
// its synchronous half is pure string/URL logic — so this costs no dependency
// in either direction and, unlike importing the built package, cannot pass
// against a stale `dist`. Both sides are compared from source.
import { validateBaseUrl } from '../../../../agent-runtime/src/providers/connection-guard.js';
import { isAllowedEndpointUrl } from '../../utils/endpoint-policy.js';

/**
 * @file Holds `@jini-ai/ui`'s `utils/endpoint-policy.ts` and `agent-runtime`'s
 * `connection-guard.ts` in agreement mechanically.
 *
 * The copy between them is deliberate and documented (`endpoint-policy.ts`'s
 * header): `endpoint-policy.ts` itself has zero imports of its own so it can
 * run in a browser bundle, and `connection-guard`'s richer half needs
 * `node:dns`. What was missing was
 * enforcement. Its instruction — "if one side's block-list changes, change the
 * other" — was a comment, and comments do not fail builds.
 *
 * The gap that motivated this got past two independent audits in opposite
 * directions: one rated the pair CLOSED off a 46-URL corpus of address forms
 * that simply did not contain a whitespace-padded case, the other reproduced
 * it. A corpus that only samples the axis you thought of proves nothing about
 * the axis you didn't, so this generates the cross-product of address forms AND
 * padding rather than listing URLs by hand.
 *
 * A divergence here is a real defect in one direction or the other: the UI
 * accepting what the runtime will refuse (an operator saves a credential
 * against an endpoint that never works), the UI refusing what the runtime would
 * allow (dead config), or — worst — the UI accepting an address the runtime
 * blocks as internal.
 */

/** Address forms both sides must classify identically. Spans the SSRF-relevant boundaries, not just happy paths. */
const ADDRESS_FORMS: readonly string[] = [
  // Public — allowed.
  'https://api.openai.com',
  'https://api.openai.com/v1',
  'http://example.com:8080',
  // Loopback — allowed on purpose (local model servers).
  'http://localhost:11434',
  'http://localhost.',
  'http://127.0.0.1',
  'http://127.1.2.3',
  'http://[::1]',
  'http://[::ffff:127.0.0.1]',
  // Private / link-local / CGNAT / multicast / unspecified — blocked.
  'http://10.0.0.1',
  'http://10.255.255.255',
  'http://192.168.1.1',
  'http://172.16.0.1',
  'http://172.31.255.255',
  'http://172.32.0.1', // just OUTSIDE the private range — must stay allowed
  'http://100.64.0.1',
  'http://100.63.255.255', // just outside CGNAT
  'http://169.254.169.254', // cloud metadata
  'http://0.0.0.0',
  'http://224.0.0.1',
  'http://239.255.255.255',
  'http://[::]',
  'http://[fc00::1]',
  'http://[fd12:3456::1]',
  'http://[fe80::1]',
  'http://[::ffff:10.0.0.1]',
  'http://[::ffff:a00:1]', // same address, hex form
  // Scheme rejections.
  'ftp://example.com',
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,x',
  // Not absolute / malformed.
  'example.com',
  '//example.com',
  'http://',
  '',
  'not a url',
];

/**
 * Every character `String.prototype.trim` strips, by code point.
 *
 * The two implementations always agreed on ASCII space, because WHATWG URL
 * parsing removes that itself. They diverged on exactly the characters `trim`
 * removes and the URL parser does not — NBSP, BOM, thin space and friends.
 * Naming them by code point rather than typing them keeps the corpus honest:
 * an invisible character pasted into a source file is one reformat away from
 * silently becoming an ordinary space, and the test would then pass while
 * covering nothing.
 */
const TRIMMABLE = [
  0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c, 0xa0, 0xfeff, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x202f, 0x205f, 0x3000, 0x2028, 0x2029,
] as const;

function agrees(raw: string): { ui: boolean; runtime: boolean } {
  return { ui: isAllowedEndpointUrl(raw), runtime: !('error' in validateBaseUrl(raw)) };
}

describe('endpoint-policy / connection-guard parity', () => {
  it('every character in the padding corpus is actually stripped by trim()', () => {
    // Guards the guard: a code point that `trim` does NOT strip would silently
    // weaken every case below into a no-op.
    const notStripped = TRIMMABLE.filter((code) => String.fromCodePoint(code).trim() !== '');
    expect(notStripped).toEqual([]);
  });

  it.each(ADDRESS_FORMS)('agrees on %j unpadded', (form) => {
    const { ui, runtime } = agrees(form);
    expect({ form, ui }).toEqual({ form, ui: runtime });
  });

  it('agrees on every address form under every trimmable padding, in all three positions', () => {
    const divergent: Array<{ form: string; codePoint: string; position: string; ui: boolean; runtime: boolean }> = [];
    for (const code of TRIMMABLE) {
      const ws = String.fromCodePoint(code);
      const codePoint = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
      for (const form of ADDRESS_FORMS) {
        for (const [position, padded] of [
          ['lead', ws + form],
          ['trail', form + ws],
          ['both', ws + form + ws],
        ] as const) {
          const { ui, runtime } = agrees(padded);
          if (ui !== runtime) divergent.push({ form, codePoint, position, ui, runtime });
        }
      }
    }
    expect(divergent).toEqual([]);
  });

  it('padding never turns a blocked address into an allowed one', () => {
    // Parity alone would be satisfied by both sides being wrong TOGETHER, so
    // this pins the absolute answer for the addresses that matter: no amount of
    // invisible padding may make private space acceptable to either side.
    const mustStayBlocked = [
      'http://10.0.0.1',
      'http://169.254.169.254',
      'http://192.168.1.1',
      'http://[::ffff:10.0.0.1]',
      'http://0.0.0.0',
    ];
    for (const code of TRIMMABLE) {
      const ws = String.fromCodePoint(code);
      for (const form of mustStayBlocked) {
        for (const padded of [ws + form, form + ws, ws + form + ws]) {
          expect(isAllowedEndpointUrl(padded), `ui allowed ${JSON.stringify(padded)}`).toBe(false);
          expect('error' in validateBaseUrl(padded), `runtime allowed ${JSON.stringify(padded)}`).toBe(true);
        }
      }
    }
  });

  it('reproduces the exact case that motivated this — an NBSP-padded public URL', () => {
    // The counterexample one audit produced and the other's corpus lacked.
    const nbsp = String.fromCodePoint(0x00a0);
    const nbspPadded = `${nbsp}https://example.com${nbsp}`;
    // If this ever becomes an ordinary space the case is gone, not fixed.
    expect(nbspPadded).not.toBe(' https://example.com ');
    expect(isAllowedEndpointUrl(nbspPadded)).toBe(true);
    expect(validateBaseUrl(nbspPadded)).not.toHaveProperty('error');
  });
});
