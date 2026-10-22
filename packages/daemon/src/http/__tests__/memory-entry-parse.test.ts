import { describe, expect, it } from 'vitest';
import type { RouteInputContext } from '@jini-ai/http-kit';
import { memoryCreateEntryRoute, memoryUpdateEntryRoute } from '../memory.js';

/** Pins every branch of the entry-body parser shared by `POST /api/memory` and `PUT /api/memory/:id`. */
function ctx({ body }: { body: unknown }, { params = {} }: { params?: Record<string, string> } = {}): RouteInputContext {
  return { body, query: {}, params };
}

const parse = (body: unknown) => memoryCreateEntryRoute.parse(ctx({ body }));

function requiredIssue(field: 'name' | 'type') {
  return {
    ok: false,
    error: {
      code: 'BAD_REQUEST',
      message: `${field} is required`,
      details: { kind: 'validation', issues: [{ path: field, message: 'required non-empty string' }] },
    },
  };
}

describe('memory entry body parser', () => {
  it('refuses a non-object body', () => {
    expect(parse('nope')).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('refuses an array body', () => {
    expect(parse([])).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('refuses a missing name', () => {
    expect(parse({ type: 't' })).toEqual(requiredIssue('name'));
  });

  it('refuses an empty name', () => {
    expect(parse({ name: '', type: 't' })).toEqual(requiredIssue('name'));
  });

  it('refuses a non-string name', () => {
    expect(parse({ name: 7, type: 't' })).toEqual(requiredIssue('name'));
  });

  it('refuses a missing type', () => {
    expect(parse({ name: 'n' })).toEqual(requiredIssue('type'));
  });

  it('refuses an empty type', () => {
    expect(parse({ name: 'n', type: '' })).toEqual(requiredIssue('type'));
  });

  it('refuses a non-string type', () => {
    expect(parse({ name: 'n', type: false })).toEqual(requiredIssue('type'));
  });

  it('checks name before type when both are missing', () => {
    expect(parse({})).toEqual(requiredIssue('name'));
  });

  it('refuses a non-string description', () => {
    expect(parse({ name: 'n', type: 't', description: 1 })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'description must be a string when provided' },
    });
  });

  it('refuses a null description (null is not "absent")', () => {
    expect(parse({ name: 'n', type: 't', description: null })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'description must be a string when provided' },
    });
  });

  it('refuses a non-string body field', () => {
    expect(parse({ name: 'n', type: 't', body: {} })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'body must be a string when provided' },
    });
  });

  it('checks description before body when both are malformed', () => {
    expect(parse({ name: 'n', type: 't', description: 1, body: 2 })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'description must be a string when provided' },
    });
  });

  it('accepts the minimal entry and omits absent optional fields', () => {
    expect(parse({ name: 'n', type: 't' })).toEqual({ ok: true, value: { name: 'n', type: 't' } });
  });

  it('keeps empty-string optional fields', () => {
    expect(parse({ name: 'n', type: 't', description: '', body: '' })).toEqual({
      ok: true,
      value: { name: 'n', type: 't', description: '', body: '' },
    });
  });

  it('drops unknown fields, including a body-supplied id', () => {
    expect(parse({ id: 'smuggled', name: 'n', type: 't', extra: true })).toEqual({ ok: true, value: { name: 'n', type: 't' } });
  });

  it('PUT validates the id before the body', () => {
    expect(memoryUpdateEntryRoute.parse(ctx({ body: 'nope' }, { params: { id: '' } }))).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'id must be a non-empty path parameter' },
    });
  });

  it('PUT surfaces the entry parser refusal', () => {
    expect(memoryUpdateEntryRoute.parse(ctx({ body: { type: 't' } }, { params: { id: 'a' } }))).toEqual(requiredIssue('name'));
  });

  it('PUT returns the path id beside the parsed entry', () => {
    expect(memoryUpdateEntryRoute.parse(ctx({ body: { name: 'n', type: 't', body: 'b' } }, { params: { id: 'a' } }))).toEqual({
      ok: true,
      value: { id: 'a', input: { name: 'n', type: 't', body: 'b' } },
    });
  });
});
