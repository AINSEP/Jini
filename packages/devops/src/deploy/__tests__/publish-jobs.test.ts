import { describe, expect, it } from 'vitest';
import { createPublishJobStore } from '../publish-jobs.js';

describe('publish jobs: bounded snapshots independent of a delegated call', () => {
  it('returns a job immediately, retains progress and final output, and scopes reads', () => {
    const store = createPublishJobStore<{ url: string }>({});
    const started = store.begin({ jobId: 'job-1', scopeId: 'site-a', requestId: 'execution-1', target: 'host', startedAtIso: 'start' });
    expect(started).toMatchObject({ jobId: 'job-1', status: 'running', progress: { phase: 'exporting', deploymentCreated: false, uploadedFiles: 0 } });
    store.progress({ jobId: 'job-1', progress: { phase: 'uploading', uploadedFiles: 2, totalFiles: 3, deploymentCreated: false } });
    expect(store.get({ scopeId: 'site-b', jobId: 'job-1' })).toBeUndefined();
    expect(store.get({ scopeId: 'site-a', jobId: 'job-1' })?.progress.uploadedFiles).toBe(2);
    store.settle({ jobId: 'job-1', status: 'completed', finishedAtIso: 'end', result: { url: 'https://new.test' } });
    store.begin({ jobId: 'job-2', scopeId: 'site-b', target: 'host', startedAtIso: 'next' });
    expect(store.get({ scopeId: 'site-a', jobId: 'job-1' })).toMatchObject({ status: 'completed', result: { url: 'https://new.test' } });
    expect(store.get({ scopeId: 'site-a' })?.jobId).toBe('job-1');
    expect(store.get({ scopeId: 'site-a', requestId: 'execution-1' })?.jobId).toBe('job-1');
    expect(store.get({ scopeId: 'site-a', requestId: 'another-call' })).toBeUndefined();
  });

  it('enforces single flight and ignores late progress after settlement', () => {
    const store = createPublishJobStore({});
    store.begin({ jobId: 'one', scopeId: 'a', target: 'host', startedAtIso: 'start' });
    expect(() => store.begin({ jobId: 'two', scopeId: 'a', target: 'host', startedAtIso: 'start' })).toThrow(/running/);
    store.settle({ jobId: 'one', status: 'errored', finishedAtIso: 'end', error: 'Check the hosting dashboard.' });
    store.progress({ jobId: 'one', progress: { phase: 'uploading', uploadedFiles: 99 } });
    expect(store.get({ scopeId: 'a' })?.progress.uploadedFiles).toBe(0);
  });

  it('bounds completed retention and cannot evict a running job', () => {
    const store = createPublishJobStore({}, { maxCompleted: 1 });
    for (const id of ['one', 'two']) {
      store.begin({ jobId: id, scopeId: 'a', target: 'host', startedAtIso: id });
      store.settle({ jobId: id, status: 'completed', finishedAtIso: id });
    }
    store.begin({ jobId: 'active', scopeId: 'a', target: 'host', startedAtIso: 'now' });
    expect(store.get({ scopeId: 'a', jobId: 'one' })).toBeUndefined();
    expect(store.get({ scopeId: 'a', jobId: 'two' })?.status).toBe('completed');
    expect(store.latest()?.jobId).toBe('active');
  });
});

it('recovery text distinguishes unknown creation and acknowledged bytes without claiming an old URL is live', async () => {
  const { publishJobRecoveryMessage } = await import('../publish-jobs.js');
  const jobs = createPublishJobStore({});
  jobs.begin({ jobId: 'one', scopeId: 'a', target: 'host', startedAtIso: 'start', requestId: 'run-1' });
  jobs.progress({ jobId: 'one', progress: { phase: 'creating', deploymentCreated: 'unknown', uploadedFiles: 2, totalFiles: 3 } });
  const message = publishJobRecoveryMessage({ job: jobs.get({ scopeId: 'a' }), statusToolId: 'get_publish_status' });
  expect(message).toContain('Deployment: unknown');
  expect(message).toContain('2 of 3');
  expect(message).toContain('one');
  expect(message).toContain('get_publish_status');
  const unknown = publishJobRecoveryMessage({ statusToolId: 'get_publish_status' });
  expect(unknown).toContain('uploaded files: unknown');
  expect(unknown).toContain('could not be confirmed');
  expect(unknown).not.toContain('No publish job was recorded');
});
