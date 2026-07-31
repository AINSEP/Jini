/**
 * Result of a "send a test notification" attempt, as far as a UI ever needs
 * to distinguish it — deliberately narrower than the 4-value shape
 * ('shown'/'unsupported'/'permission-denied'/'failed') the underlying
 * browser-notification attempt conceptually maps to. A caller only offers
 * this action once desktop notifications are already enabled *and*
 * permission is already granted (the only state a test send makes sense
 * in), so 'unsupported'/'permission-denied' can never actually come back —
 * this type doesn't carry members nothing can produce. See
 * `NotificationsTab`'s doc comment for the specific gate that makes that
 * true there.
 */
export type TestStatus = 'sent' | 'failed';

/** Display text for a `TestStatus` — the one piece of copy-selection logic
 *  behind the "Test notification sent." / "Could not send a test
 *  notification." status line. */
export function testStatusLabel(result: TestStatus, labels: { testSentLabel: string; testFailedLabel: string }): string {
  return result === 'sent' ? labels.testSentLabel : labels.testFailedLabel;
}
