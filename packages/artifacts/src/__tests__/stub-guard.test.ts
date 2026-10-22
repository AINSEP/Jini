import { describe, expect, it } from 'vitest';
import {
  ArtifactRegressionError,
  DEFAULT_ARTIFACT_STUB_GUARD_CONFIG,
  artifactIdentifiersMatch,
  classifyArtifactStubGuard,
  readArtifactStubGuardConfigFromEnv,
  slugifyArtifactIdentifier,
  type ArtifactStubGuardConfig,
  type PriorArtifactSibling,
} from '../stub-guard.js';

describe('slugifyArtifactIdentifier', () => {
  it('lowercases and hyphenates non-alphanumeric runs', () => {
    expect(slugifyArtifactIdentifier({ value: 'Landing Page' })).toBe('landing-page');
  });

  it('strips leading/trailing hyphens and truncates at 60 chars', () => {
    expect(slugifyArtifactIdentifier({ value: '  --Hi--  ' })).toBe('hi');
    expect(slugifyArtifactIdentifier({ value: 'a'.repeat(80) })).toHaveLength(60);
  });

  it('produces an empty string for all-non-ASCII input', () => {
    expect(slugifyArtifactIdentifier({ value: '测试' })).toBe('');
  });
});

describe('artifactIdentifiersMatch', () => {
  it('matches identical identifiers', () => {
    expect(artifactIdentifiersMatch({ a: 'dashboard', b: 'dashboard' })).toBe(true);
  });

  it('bridges a raw identifier and its slug form', () => {
    expect(artifactIdentifiersMatch({ a: 'Landing Page', b: 'landing-page' })).toBe(true);
    expect(artifactIdentifiersMatch({ a: 'landing-page', b: 'Landing Page' })).toBe(true);
  });

  it('rejects two distinct identifiers that only match after slugification without one being the slug itself', () => {
    // "A B" and "A_B" both slugify to "a-b", but neither raw identifier IS "a-b".
    expect(artifactIdentifiersMatch({ a: 'A B', b: 'A_B' })).toBe(false);
  });

  it('rejects when either identifier is empty-slug (e.g. both non-ASCII)', () => {
    expect(artifactIdentifiersMatch({ a: '测试', b: '首页' })).toBe(false);
  });

  it('rejects genuinely different identifiers', () => {
    expect(artifactIdentifiersMatch({ a: 'dashboard', b: 'settings' })).toBe(false);
  });
});

describe('classifyArtifactStubGuard (pure decision function)', () => {
  const config: ArtifactStubGuardConfig = { ...DEFAULT_ARTIFACT_STUB_GUARD_CONFIG };

  it('passes when mode is off', () => {
    expect(classifyArtifactStubGuard({ priors: [{ name: 'a.html', size: 10000 }], identifier: 'id', newSize: 1, config: { ...config, mode: 'off' } })).toEqual({
      outcome: 'pass',
    });
  });

  it('passes when identifier is empty', () => {
    expect(classifyArtifactStubGuard({ priors: [{ name: 'a.html', size: 10000 }], identifier: '', newSize: 1, config })).toEqual({ outcome: 'pass' });
  });

  it('passes when there are no priors', () => {
    expect(classifyArtifactStubGuard({ priors: [], identifier: 'id', newSize: 1, config })).toEqual({ outcome: 'pass' });
  });

  it('passes when the largest prior is below minPriorBytes', () => {
    const priors: PriorArtifactSibling[] = [{ name: 'a.html', size: 100 }];
    expect(classifyArtifactStubGuard({ priors, identifier: 'id', newSize: 1, config })).toEqual({ outcome: 'pass' });
  });

  it('passes when the new size meets the retained-ratio threshold', () => {
    const priors: PriorArtifactSibling[] = [{ name: 'a.html', size: 10000 }];
    expect(classifyArtifactStubGuard({ priors, identifier: 'id', newSize: 3000, config })).toEqual({ outcome: 'pass' });
  });

  it('warns (mode=warn) when the new size is below threshold, picking the largest of several priors', () => {
    const priors: PriorArtifactSibling[] = [
      { name: 'small.html', size: 5000 },
      { name: 'big.html', size: 10000 },
    ];
    const result = classifyArtifactStubGuard({ priors, identifier: 'id', newSize: 100, config });
    expect(result.outcome).toBe('warn');
    expect(result.warning?.priorName).toBe('big.html');
    expect(result.warning?.priorSize).toBe(10000);
    expect(result.warning?.newSize).toBe(100);
    expect(result.warning?.identifier).toBe('id');
    expect(result.warning?.code).toBe('ARTIFACT_REGRESSION');
    expect(result.warning?.message).toContain('big.html');
  });

  it('rejects (mode=reject) when the new size is below threshold', () => {
    const priors: PriorArtifactSibling[] = [{ name: 'big.html', size: 10000 }];
    const result = classifyArtifactStubGuard({ priors, identifier: 'id', newSize: 100, config: { ...config, mode: 'reject' } });
    expect(result.outcome).toBe('reject');
    expect(result.warning).toBeDefined();
  });
});

describe('ArtifactRegressionError', () => {
  it('carries the regression details', () => {
    const err = new ArtifactRegressionError({ message: 'shrunk', details: {
      identifier: 'id',
      newSize: 10,
      priorSize: 5000,
      priorName: 'a.html',
    } });
    expect(err.code).toBe('ARTIFACT_REGRESSION');
    expect(err.identifier).toBe('id');
    expect(err.newSize).toBe(10);
    expect(err.priorSize).toBe(5000);
    expect(err.priorName).toBe('a.html');
    expect(err.name).toBe('ArtifactRegressionError');
  });
});

describe('readArtifactStubGuardConfigFromEnv', () => {
  it('falls back to defaults when env vars are unset', () => {
    expect(readArtifactStubGuardConfigFromEnv({ env: {}, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } })).toEqual(DEFAULT_ARTIFACT_STUB_GUARD_CONFIG);
  });

  it('reads a valid mode/ratio/minPriorBytes from env', () => {
    const config = readArtifactStubGuardConfigFromEnv({ env: {
      ARTIFACT_STUB_GUARD: 'reject',
      ARTIFACT_STUB_GUARD_MIN_RATIO: '0.5',
      ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES: '2048',
    }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } });
    expect(config.mode).toBe('reject');
    expect(config.minRetainedRatio).toBe(0.5);
    expect(config.minPriorBytes).toBe(2048);
  });

  it('accepts "warn" and "off" modes too', () => {
    expect(readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD: 'warn' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).mode).toBe('warn');
    expect(readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD: 'off' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).mode).toBe('off');
  });

  it('falls back to the default mode for an unrecognized value', () => {
    expect(readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD: 'bogus' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).mode).toBe(
      DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.mode,
    );
  });

  it('falls back to the default ratio for out-of-range or non-numeric values', () => {
    expect(readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD_MIN_RATIO: '0' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).minRetainedRatio).toBe(
      DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minRetainedRatio,
    );
    expect(readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD_MIN_RATIO: '1.5' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).minRetainedRatio).toBe(
      DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minRetainedRatio,
    );
    expect(readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD_MIN_RATIO: 'nope' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).minRetainedRatio).toBe(
      DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minRetainedRatio,
    );
    expect(readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD_MIN_RATIO: '1' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).minRetainedRatio).toBe(1);
  });

  it('falls back to the default minPriorBytes for a non-positive or non-integer value', () => {
    expect(
      readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES: '0' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).minPriorBytes,
    ).toBe(DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minPriorBytes);
    expect(
      readArtifactStubGuardConfigFromEnv({ env: { ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES: '1.5' }, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }).minPriorBytes,
    ).toBe(DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minPriorBytes);
  });

  it('uses process.env by default', () => {
    const config = readArtifactStubGuardConfigFromEnv({ env: {}, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } });
    expect(config.mode).toBe(DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.mode);
  });

  it('preserves siblingExtensions from the supplied defaults', () => {
    const customDefaults: ArtifactStubGuardConfig = {
      ...DEFAULT_ARTIFACT_STUB_GUARD_CONFIG,
      siblingExtensions: ['.md'],
    };
    expect(readArtifactStubGuardConfigFromEnv({ env: {}, names: { mode: 'ARTIFACT_STUB_GUARD', minRatio: 'ARTIFACT_STUB_GUARD_MIN_RATIO', minPriorBytes: 'ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES' } }, { defaults: customDefaults }).siblingExtensions).toEqual(['.md']);
  });
});
