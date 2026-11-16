import { describe, expect, it } from 'vitest';
import { serverConformance } from '../conformance.js';
import { createInMemoryServer } from '../testing.js';

serverConformance({ describe, it, expect: (value) => expect(value) as never }, { makeServer: () => createInMemoryServer() });
