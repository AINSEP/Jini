import { afterEach, expect, test, vi } from 'vitest';
import { PostHog } from 'posthog-node';
import { createPostHogProductAnalyticsAdapter } from '../../analytics-posthog/posthog.js';

afterEach(() => { vi.restoreAllMocks(); });

test('sparse server events omit empty traits, groups, and absent AI content', async () => {
  const capture = vi.spyOn(PostHog.prototype, 'capture').mockImplementation(() => {});
  const resource = createPostHogProductAnalyticsAdapter({ config: { enabled: true, apiKey: 'phc_fixture',
    host: 'https://collector.invalid', includePromptsAndResponses: true,
    attribution: { attributes: { site_id: 'site-1' }, groups: {} },
  } });
  try {
    resource.port.identify({ userId: 'person' });
    resource.port.captureAiGeneration!({ userId: 'person', properties: { model: 'fixture', extra: 'private' } });
    expect(capture.mock.calls).toEqual([
      [{ distinctId: 'person', event: '$identify', properties: { site_id: 'site-1', $process_person_profile: false } }],
      [{ distinctId: 'person', event: '$ai_generation', properties: { $ai_model: 'fixture', site_id: 'site-1', $process_person_profile: false } }],
    ]);
    expect(resource.port.includeAiContent).toBe(true);
  } finally { await resource.dispose(); }
});
