/** Single-process stand-in for the blob fence: runs the write with no existing-row claim. Tests that
 * exercise the cross-process fence itself use `blob-fence-harness.ts` instead. */
export const passthroughBlobFence = {
  claimWrite: async <T>({ work }: { work: (claim: { existing: null }) => Promise<T> }): Promise<T> => work({ existing: null }),
};
