import { describe, expect, it } from 'vitest';
import { isLoopbackApiHost, isBlockedExternalApiHostname } from '../address.js';
describe('isLoopbackApiHost', () => {
    // PARITY: copied literal-host policy vector.
    it('recognizes localhost (including trailing-dot FQDN form and mixed case)', () => {
        expect(isLoopbackApiHost({ hostname: 'localhost' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: 'LocalHost.' })).toBe(true);
    });
    // PARITY: copied literal-host policy vector.
    it('recognizes ::1, bracketed or not', () => {
        expect(isLoopbackApiHost({ hostname: '::1' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: '[::1]' })).toBe(true);
    });
    // PARITY: copied literal-host policy vector.
    it('recognizes the 127.0.0.0/8 range and rejects other IPv4 hosts', () => {
        expect(isLoopbackApiHost({ hostname: '127.0.0.1' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: '127.255.255.255' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: '8.8.8.8' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('recognizes an IPv4-mapped-IPv6 loopback literal (dotted-quad form) and rejects a non-loopback one', () => {
        expect(isLoopbackApiHost({ hostname: '::ffff:127.0.0.1' })).toBe(true);
        expect(isLoopbackApiHost({ hostname: '::ffff:8.8.8.8' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('recognizes an IPv4-mapped-IPv6 loopback literal (hex-group form)', () => {
        // ::ffff:7f00:1 == ::ffff:127.0.0.1 in the alternate hex-group notation.
        expect(isLoopbackApiHost({ hostname: '::ffff:7f00:1' })).toBe(true);
    });
    // PARITY: copied literal-host policy vector.
    it('rejects a malformed IPv4-mapped-IPv6 literal (wrong hex-group count / non-hex group) and a plain hostname', () => {
        expect(isLoopbackApiHost({ hostname: '::ffff:1:2:3' })).toBe(false);
        expect(isLoopbackApiHost({ hostname: '::ffff:zzzz:1' })).toBe(false);
        expect(isLoopbackApiHost({ hostname: 'example.com' })).toBe(false);
    });
});

describe('isBlockedExternalApiHostname', () => {
    // PARITY: copied literal-host policy vector.
    it('blocks the unspecified IPv6 address', () => {
        expect(isBlockedExternalApiHostname({ hostname: '::' })).toBe(true);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks 0.0.0.0/8', () => {
        expect(isBlockedExternalApiHostname({ hostname: '0.1.2.3' })).toBe(true);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks CGNAT (100.64.0.0/10) at both edges and allows just outside the range', () => {
        expect(isBlockedExternalApiHostname({ hostname: '100.64.0.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '100.127.255.255' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '100.63.255.255' })).toBe(false);
        expect(isBlockedExternalApiHostname({ hostname: '100.128.0.1' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks link-local (169.254.0.0/16) and allows a neighboring /16', () => {
        expect(isBlockedExternalApiHostname({ hostname: '169.254.0.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '169.253.0.1' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks 10.0.0.0/8', () => {
        expect(isBlockedExternalApiHostname({ hostname: '10.1.2.3' })).toBe(true);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks 192.168.0.0/16 and allows a neighboring /16', () => {
        expect(isBlockedExternalApiHostname({ hostname: '192.168.1.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '192.167.1.1' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks 172.16.0.0/12 at both edges and allows just outside the range', () => {
        expect(isBlockedExternalApiHostname({ hostname: '172.16.0.0' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '172.31.255.255' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '172.15.255.255' })).toBe(false);
        expect(isBlockedExternalApiHostname({ hostname: '172.32.0.1' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks multicast/reserved (>= 224.0.0.0) at the edge and allows just below it', () => {
        expect(isBlockedExternalApiHostname({ hostname: '224.0.0.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '255.255.255.255' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '223.255.255.255' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('allows a public IPv4 host and a non-IPv4 hostname', () => {
        expect(isBlockedExternalApiHostname({ hostname: '8.8.8.8' })).toBe(false);
        expect(isBlockedExternalApiHostname({ hostname: 'example.com' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('treats a malformed IPv4 octet (non-digit or out-of-range) as not a parseable IPv4 address', () => {
        expect(isBlockedExternalApiHostname({ hostname: '1.2.3.abc' })).toBe(false);
        expect(isBlockedExternalApiHostname({ hostname: '1.2.3.999' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks IPv6 unique-local (fc00::/7)', () => {
        expect(isBlockedExternalApiHostname({ hostname: 'fc00::1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: 'fd12:3456::1' })).toBe(true);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks IPv6 link-local (fe80::/10) and allows a neighboring prefix', () => {
        expect(isBlockedExternalApiHostname({ hostname: 'fe80::1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: 'fe70::1' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('blocks an IPv4-mapped-IPv6 blocked address and allows a non-blocked one', () => {
        expect(isBlockedExternalApiHostname({ hostname: '::ffff:10.0.0.1' })).toBe(true);
        expect(isBlockedExternalApiHostname({ hostname: '::ffff:8.8.8.8' })).toBe(false);
    });
    // PARITY: copied literal-host policy vector.
    it('normalizes a trailing-dot FQDN before parsing (10.0.0.1. still blocks)', () => {
        expect(isBlockedExternalApiHostname({ hostname: '10.0.0.1.' })).toBe(true);
    });
    // PARITY: copied literal-host policy vector.
    it('normalizes a bracketed IPv6 literal', () => {
        expect(isBlockedExternalApiHostname({ hostname: '[fc00::1]' })).toBe(true);
    });
});

