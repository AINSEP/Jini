import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';

describe('@jini-ai/capability-providers/unsafe-reference barrel completeness', () => {
  it('re-exports every reference provider factory', () => {
    expect(barrel.createInMemoryAuthProvider).toBeTypeOf('function');
    expect(barrel.createInMemoryStorageProvider).toBeTypeOf('function');
    expect(barrel.createInMemoryPaymentsProvider).toBeTypeOf('function');
    expect(barrel.createInMemoryDbProvider).toBeTypeOf('function');
    expect(barrel.createInMemoryRealtimeProvider).toBeTypeOf('function');
  });
});
