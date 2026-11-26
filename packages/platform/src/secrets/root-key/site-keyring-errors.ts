import type { RootKeyRejection } from '../keyring.env.js';
import type { SiteKeySource } from './material.js';

export function createSiteKeyringErrors(required: {
  UnusableSiteKeyError: abstract new (...args: never[]) => Error & { source: 'env' | 'file'; reason: RootKeyRejection };
  describeSource(source: SiteKeySource): string;
  copy: {
    envVarName: string; fileWarningSubject: string; envWarningSubject: string;
    rejectionDetail: Record<RootKeyRejection, (required: { hexDigits: number }) => string>;
    refusal(required: { subject: string; detail: string }): string;
    sealedWarning(required: { subject: string }): string;
    alreadyExists(required: { keyFilePath: string }): string;
    rootRefusal: string; siteRefusal: string;
  };
}, _optional = {}) {
  class UnusableSiteKeyError extends Error {
    readonly source: 'env' | 'file';
    readonly reason: RootKeyRejection;
    constructor(input: { source: 'env' | 'file'; reason: RootKeyRejection; message: string }) {
      super(input.message);
      this.name = 'UnusableSiteKeyError'; this.source = input.source; this.reason = input.reason;
    }
  }
  class SiteKeyFileAlreadyExistsError extends Error {
    constructor(input: { keyFilePath: string }) {
      super(required.copy.alreadyExists(input)); this.name = 'SiteKeyFileAlreadyExistsError';
    }
  }
  return {
    UnusableSiteKeyError, SiteKeyFileAlreadyExistsError,
    unusableSiteKeyError: ({ source, rejection }: { source: SiteKeySource; rejection: { reason: RootKeyRejection; hexDigits: number } }) => {
      const isEnv = source.kind === 'env';
      const subject = isEnv ? required.copy.envVarName : required.describeSource(source);
      const detail = required.copy.rejectionDetail[rejection.reason]({ hexDigits: rejection.hexDigits });
      const sealedWarningSubject = !isEnv ? required.copy.fileWarningSubject : rejection.reason === 'too-short' ? required.copy.envWarningSubject : undefined;
      const refusal = required.copy.refusal({ subject, detail });
      return new UnusableSiteKeyError({ source: isEnv ? 'env' : 'file', reason: rejection.reason,
        message: sealedWarningSubject === undefined ? refusal : refusal + required.copy.sealedWarning({ subject: sealedWarningSubject }),
      });
    },
    rethrowKeyringError: ({ error }: { error: unknown }): never => {
      if (error instanceof required.UnusableSiteKeyError) throw new UnusableSiteKeyError({ source: error.source, reason: error.reason, message: error.message.replace(required.copy.rootRefusal, required.copy.siteRefusal) });
      throw error;
    },
  };
}
