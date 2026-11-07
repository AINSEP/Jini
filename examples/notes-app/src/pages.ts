/**
 * @file Page chrome and small Request/Response helpers.
 *
 * GAP: Jini has no neutral server-side page renderer for entries (cms `presentation` only stores the
 * active theme id; http-kit's HTML helpers are Express-bound), so these templates are hand-written.
 * GAP: no neutral helpers for `Response` building (html/json/redirect) or reading an urlencoded
 * body from a web `Request`; they are a few lines each here.
 */
import { escapeHtml } from '@jini-ai/core/text';
import type { EntryRecord } from '@jini-ai/cms/entries';

const e = (text: string): string => escapeHtml({ text });

export function html(body: string, init: { status?: number } = {}): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Notes</title></head>` +
    `<body><main>${body}</main></body></html>`, { status: init.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export function json(value: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(value), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } });
}

export function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

/** Reads an urlencoded or multipart body into a flat string record (repeated keys keep the last value). */
export async function readForm(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const out: Record<string, string> = {};
  form.forEach((value, key) => { if (typeof value === 'string') out[key] = value; });
  return out;
}

export function listPage({ notes }: { notes: readonly EntryRecord[] }): string {
  const items = notes.map((n) => `<li><a href="/notes/${encodeURIComponent(n.slug)}">${e(n.title)}</a> <small>${e(n.status)}</small></li>`).join('');
  return `<h1>Notes</h1><ul>${items || '<li>No notes yet.</li>'}</ul>` +
    `<h2>New note</h2><form method="post" action="/notes">` +
    `<label>Title <input name="title" required></label> <label>Slug <input name="slug" required pattern="[a-z0-9-]+"></label>` +
    `<label>Body <textarea name="body"></textarea></label><button type="submit">Create</button></form>`;
}

export function notePage({ note, body, contactHtml, sent }: { note: EntryRecord; body: string; contactHtml: string; sent: boolean }): string {
  const path = `/notes/${encodeURIComponent(note.slug)}`;
  return `<p><a href="/">All notes</a></p><article><h1>${e(note.title)}</h1>` +
    `<p><small>${e(note.status)} · version ${note.version}${note.publishedAt ? ` · published ${e(note.publishedAt)}` : ''}</small></p>` +
    `<div>${e(body).replace(/\n/g, '<br>')}</div></article>` +
    `<h2>Edit</h2><form method="post" action="${path}/edit"><input type="hidden" name="version" value="${note.version}">` +
    `<label>Title <input name="title" value="${e(note.title)}"></label><label>Body <textarea name="body">${e(body)}</textarea></label>` +
    `<button type="submit">Save</button></form>` +
    (note.status === 'published' ? '' : `<form method="post" action="${path}/publish"><button type="submit">Publish</button></form>`) +
    `<h2>Contact the author</h2>${sent ? '<p role="status">Thanks, your message was sent.</p>' : ''}${contactHtml}`;
}
