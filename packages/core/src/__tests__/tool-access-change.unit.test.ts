import { describe, expect, it } from 'vitest';
import { ToolAccessLoweringError } from '../tool-access-change.js';

describe('ToolAccessLoweringError', () => {
  it('is an Error carrying the stable stop-failed code and the fixed message', () => {
    const error = new ToolAccessLoweringError();
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ToolAccessLoweringError);
    expect(error.code).toBe('TOOL_ACCESS_STOP_FAILED');
    expect(error.message).toBe('Tool access changed, but affected answers could not be confirmed stopped.');
  });
});
