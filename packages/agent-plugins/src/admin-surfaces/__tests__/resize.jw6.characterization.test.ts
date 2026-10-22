import { expect, it } from 'vitest';
import { readAdminSurfaceResize } from '../host-validator.js';
import { ADMIN_SURFACE_PROTOCOL, ADMIN_SURFACE_PROTOCOL_VERSION } from '../protocol.js';

it('checks transport before reading data and validates the envelope before reading height', () => {
  const frame = {}; const mount = { frame, mountId: 'mount' };
  const data = { protocol: 'wrong', get height(): never { throw new Error('height read'); } };
  expect(readAdminSurfaceResize({ mount, event: { source: frame, origin: 'null', data } })).toBeNull();
  const event = { source: {}, origin: 'null', get data(): never { throw new Error('data read'); } };
  expect(readAdminSurfaceResize({ mount, event })).toBeNull();
});
it('preserves round-then-clamp ordering with custom bounds including zero', () => {
  const frame = {}; const mount = { frame, mountId: 'mount' };
  const event = { source: frame, origin: 'null', data: { protocol: ADMIN_SURFACE_PROTOCOL, version: ADMIN_SURFACE_PROTOCOL_VERSION, kind: 'resize', mountId: 'mount', height: 1.2 } };
  expect(readAdminSurfaceResize({ mount, event }, { min: 0, max: 0 })).toBe(0);
  expect(readAdminSurfaceResize({ mount, event }, { min: 1.5, max: 1.7 })).toBe(1.7);
});
