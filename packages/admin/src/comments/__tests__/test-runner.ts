export { describe, expect, it, vi } from 'vitest';

// The host uses Vitest 4. This package used Vitest 2, so a composed toHaveBeenCalledExactlyOnceWith
// lived here. Vitest 3 ships that matcher natively, and redeclaring it is a duplicate-identifier error.
