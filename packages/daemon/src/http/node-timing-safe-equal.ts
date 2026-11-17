/**
 * @file The daemon's Node binding for core's injected constant-time byte comparison. Core's
 * `timingSafeTokenMatch` takes the comparison as a port so the universal kernel imports no Node;
 * a daemon gate that is not handed one uses this, never `===` (a plain compare short-circuits on
 * the first differing byte and leaks the matching prefix length).
 */
import { timingSafeEqual } from 'node:crypto';
import type { TimingSafeByteComparison } from '@jini-ai/core';

/** `node:crypto`'s constant-time comparison, adapted to core's object-argument port. */
export const nodeTimingSafeEqual: TimingSafeByteComparison = ({ left, right }) => timingSafeEqual(left, right);
