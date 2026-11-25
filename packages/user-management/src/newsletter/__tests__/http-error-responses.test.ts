import { expect, it } from 'vitest';
import {
  NewsletterValidationError, NewsletterSubscriberNotFoundError, NewsletterCampaignNotEditableError,
  NewsletterDefaultListProtectedError, NewsletterConflictError, NewsletterLaunchGateBlockedError,
  NewsletterCampaignNotFoundError, NewsletterListNotFoundError, NewsletterSubscriptionNotFoundError, NewsletterForbiddenError,
} from '../errors.js';
import { newsletterErrorResponse } from '../http-error-responses.js';

it('all ten known classes map to the existing status and flat code', () => {
  const cases = [
    { err: new NewsletterValidationError({ message: 'invalid', field: 'name', reason: 'empty' }), status: 400, body: { error: 'invalid', code: 'NEWSLETTER_VALIDATION_ERROR', details: { field: 'name', reason: 'empty' } } },
    { err: new NewsletterSubscriberNotFoundError({ message: 'subscriber', subscriberId: 'sub' }), status: 400, body: { error: 'subscriber', code: 'NEWSLETTER_SUBSCRIBER_NOT_FOUND', details: { subscriberId: 'sub' } } },
    { err: new NewsletterCampaignNotEditableError({ message: 'editable', currentStatus: 'sent', attemptedAction: 'edit' }), status: 409, body: { error: 'editable', code: 'NEWSLETTER_CAMPAIGN_NOT_EDITABLE', details: { currentStatus: 'sent', attemptedAction: 'edit' } } },
    { err: new NewsletterDefaultListProtectedError({ message: 'protected', listId: 'list' }), status: 409, body: { error: 'protected', code: 'NEWSLETTER_DEFAULT_LIST_PROTECTED', details: { listId: 'list' } } },
    { err: new NewsletterConflictError({ message: 'conflict', entity: 'campaign', id: 'id', expectedVersion: 1, actualVersion: 2 }), status: 409, body: { error: 'conflict', code: 'NEWSLETTER_CONFLICT', details: { entity: 'campaign', id: 'id', expectedVersion: 1, actualVersion: 2 } } },
    { err: new NewsletterLaunchGateBlockedError({ message: 'blocked', unmetPreconditions: ['sender'] }), status: 409, body: { error: 'blocked', code: 'NEWSLETTER_LAUNCH_GATE_BLOCKED', details: { unmetPreconditions: ['sender'] } } },
    { err: new NewsletterCampaignNotFoundError('campaign'), status: 404, body: { error: 'campaign', code: 'NEWSLETTER_CAMPAIGN_NOT_FOUND' } },
    { err: new NewsletterListNotFoundError('list'), status: 404, body: { error: 'list', code: 'NEWSLETTER_LIST_NOT_FOUND' } },
    { err: new NewsletterSubscriptionNotFoundError('subscription'), status: 404, body: { error: 'subscription', code: 'NEWSLETTER_SUBSCRIPTION_NOT_FOUND' } },
    { err: new NewsletterForbiddenError('forbidden'), status: 403, body: { error: 'forbidden', code: 'FORBIDDEN' } },
  ];
  for (const { err, status, body } of cases) expect(newsletterErrorResponse({ err })).toEqual({ status, body });
});

it('an unknown error with a secret-shaped message falls through', () => {
  expect(newsletterErrorResponse({ err: new Error('token=secret-password') })).toBeUndefined();
});
