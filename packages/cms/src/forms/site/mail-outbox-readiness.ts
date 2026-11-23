/** The forms module binds notification jobs to the shared outbox; other mail lanes still need wiring. */
export const formsMailOutboxReady = ({ capabilityName }: { capabilityName: string }, _optional = {}): boolean => capabilityName === 'forms';
