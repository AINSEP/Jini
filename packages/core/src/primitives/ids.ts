/** Unbranded identifier; UUID-producing adapters and opaque host IDs share this port. */
export type UUID = string;

export interface IdGenerator { newId(): string }
