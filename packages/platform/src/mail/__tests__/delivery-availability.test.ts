import { expect, test } from 'vitest';
import { isMailDeliveryAvailable } from '../delivery-availability.js';
import type { MailerPort } from '../ports.js';

function mailerWithDriver(driver: string): MailerPort & { attempts: number } {
  const mailer = {
    attempts: 0,
    capabilities: () => ({ driver, supportsIdempotencyKey: false, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
    send: async () => { mailer.attempts += 1; throw new Error('availability must never send'); },
    sendBatch: async () => { mailer.attempts += 1; throw new Error('availability must never send'); },
  };
  return mailer;
}

test('only a real delivery driver counts as available; the console driver never does, and nothing is sent', () => {
  const drivers = ['console', 'smtp', 'resend'].map(mailerWithDriver);
  expect(drivers.map((mailer) => isMailDeliveryAvailable({ mailer }))).toEqual([false, true, true]);
  expect(drivers.map((mailer) => mailer.attempts)).toEqual([0, 0, 0]);
});
