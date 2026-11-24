import assert from 'node:assert/strict';
import { test } from '../../conversations/__tests__/node-test-context.js';
import { createStagedAttachmentUploader } from '../create-staged-attachment-uploader.js';
import type { AttachmentStagingPort } from '../types.js';

const createLocalAttachmentUploader = (bridge: AttachmentStagingPort) => createStagedAttachmentUploader({ bridge });

// Author Checklist mutations: drop/reorder bytes or attachment metadata; save an empty batch;
// remove the post-save abort check; swallow a save rejection; send bytes after a read rejection.
// Every asynchronous result is awaited; failures use identity checks, and held saves are settled.
// F1.2/F2.5/F3.6: pin the bytes crossing IPC as well as the complete returned attachment.
// F7.1: settle the second file first; completion order must not become composer order.
test('uploads exact bytes and preserves file identity, kind, size and order across out-of-order saves', async (t) => {
  const image = new File([new Uint8Array([0, 127, 255])], 'photo.png', { type: 'image/png' });
  const doc = new File(['notes'], 'plan.txt', { type: 'text/plain' });
  const pending = new Map<string, (value: { path: string }) => void>();
  t.after(() => { for (const finish of pending.values()) finish({ path: '/staging/cleanup' }); });
  const upload = createLocalAttachmentUploader({
    saveChatAttachment: async ({ name, data }) => {
      const expected = name === 'photo.png' ? [0, 127, 255] : name === 'plan.txt' ? [110, 111, 116, 101, 115] : undefined;
      assert.ok(expected, `unexpected file: ${name}`);
      assert.deepEqual([...new Uint8Array(data)], expected);
      assert.equal(pending.has(name), false, 'each file must be saved exactly once');
      return new Promise<{ path: string }>((resolve) => pending.set(name, resolve));
    },
  });
  const result = upload([image, doc]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual([...pending.keys()].sort(), ['photo.png', 'plan.txt']);
  pending.get('plan.txt')!({ path: '/staging/doc-2.txt' });
  pending.get('photo.png')!({ path: '/staging/image-1.png' });
  assert.deepEqual(await result, [
    { path: '/staging/image-1.png', name: 'photo.png', kind: 'image', size: 3, order: 0 },
    { path: '/staging/doc-2.txt', name: 'plan.txt', kind: 'file', size: 5, order: 1 },
  ]);
});

test('an empty batch returns no attachments and makes no IPC save', async () => {
  let saves = 0;
  const upload = createLocalAttachmentUploader({ saveChatAttachment: async () => { saves++; return { path: '/unexpected' }; } });
  assert.deepEqual(await upload([]), []);
  assert.equal(saves, 0);
});

// F6.2/F7.1: abort while the save is held, then settle it and check the late result.
test('a composer abort during staging discards the completed batch', async () => {
  const controller = new AbortController();
  let finish!: (value: { path: string }) => void;
  const upload = createLocalAttachmentUploader({
    saveChatAttachment: () => new Promise<{ path: string }>((resolve) => { finish = resolve; }),
  });
  const result = upload([new File(['x'], 'x.bin')], { signal: controller.signal, batchId: 'batch-abort' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(typeof finish, 'function');
  controller.abort();
  finish({ path: '/staging/late.bin' });
  assert.deepEqual(await result, []);
});

test('a failed IPC save rejects the batch and a later upload can succeed', async () => {
  const failure = new Error('staging disk full');
  let attempts = 0;
  const upload = createLocalAttachmentUploader({
    saveChatAttachment: async ({ name, data }) => {
      assert.equal(name, 'retry.bin');
      assert.deepEqual([...new Uint8Array(data)], [120]);
      if (++attempts === 1) throw failure;
      return { path: '/staging/retried.bin' };
    },
  });
  const file = new File(['x'], 'retry.bin');
  await assert.rejects(upload([file]), (error) => error === failure);
  assert.deepEqual(await upload([file]), [{ path: '/staging/retried.bin', name: 'retry.bin', kind: 'file', size: 1, order: 0 }]);
  assert.equal(attempts, 2);
});

test('a file read failure rejects before its bytes are sent over IPC', async (t) => {
  const file = new File(['x'], 'unreadable.bin');
  const failure = new Error('file no longer readable');
  t.mock.method(file, 'arrayBuffer', async () => { throw failure; });
  let saves = 0;
  const upload = createLocalAttachmentUploader({ saveChatAttachment: async () => { saves++; return { path: '/unexpected' }; } });
  await assert.rejects(upload([file]), (error) => error === failure);
  assert.equal(saves, 0);
});
