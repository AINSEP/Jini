import { expect, it } from 'vitest';
import { renderHeadersFile, withSecurityMeta } from '../static-security-headers.js';

it('report-only policy is not emitted as meta', () => {
  const headers = { 'Content-Security-Policy-Report-Only': "default-src 'self'", 'Referrer-Policy': 'strict-origin' };
  expect(renderHeadersFile({ headers })).toBe("/*\n  Content-Security-Policy-Report-Only: default-src 'self'\n  Referrer-Policy: strict-origin\n");
  expect(withSecurityMeta({ html: '<head><title>Title</title></head>', headers })).toBe('<head><meta name="referrer" content="strict-origin"><title>Title</title></head>');
});
