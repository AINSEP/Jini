/** @file Universal server entry (web-standard, no node: imports): receipts, the server-side consent read and the region slot. */
export { handleReceipt, readConsent } from './receipt.js';
export type { ConsentRecord, ConsentRecordPort, ReceiptOptions, ReceiptPorts } from './receipt.js';
export { headerResolver, REGION_SLOT, resolveRegion } from './region.js';
