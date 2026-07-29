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
    expect(slugifyArtifactIdentifier('Landing Page')).toBe('landing-page');
  });

  it('strips leading/trailing hyphens and truncates at 60 chars', () => {
    expect(slugifyArtifactIdentifier('  --Hi--  ')).toBe('hi');
    expect(slugifyArtifactIdentifier('a'.repeat(80))).toHaveLength(60);
  });

  it('produces an empty string for all-non-ASCII input', () => {
    expect(slugifyArtifactIdentifier('测试')).toBe('');
  });
});

describe('artifactIdentifiersMatch', () => {
  it('matches identical identifiers', () => {
    expect(artifactIdentifiersMatch('dashboard', 'dashboard')).toBe(true);
  });

  it('bridges a raw identifier and its slug form', () => {
    expect(artifactIdentifiersMatch('Landing Page', 'landing-page')).toBe(true);
    expect(artifactIdentifiersMatch('landing-page', 'Landing Page')).toBe(true);
  });

  it('rejects two distinct identifiers that only match after slugification without one being the slug itself', () => {
    // "A B" and "A_B" both slugify to "a-b", but neither raw identifier IS "a-b".
    expect(artifactIdentifiersMatch('A B', 'A_B')).toBe(false);
  });

  it('rejects when either identifier is empty-slug (e.g. both non-ASCII)', () => {
    expect(artifactIdentifiersMatch('测试', '首页')).toBe(false);
  });

  it('rejects genuinely different identifiers', () => {
    expect(artifactIdentifiersMatch('dashboard', 'settings')).toBe(false);
  });
});

describe('classifyArtifactStubGuard (pure decision function)', () => {
  const config: ArtifactStubGuardConfig = { ...DEFAULT_ARTIFACT_STUB_GUARD_CONFIG };

  it('passes when mode is off', () => {
    expect(classifyArtifactStubGuard([{ name: 'a.html', size: 10000 }], 'id', 1, { ...config, mode: 'off' })).toEqual({
      outcome: 'pass',
    });
  });

  it('passes when identifier is empty', () => {
    expect(classifyArtifactStubGuard([{ name: 'a.html', size: 10000 }], '', 1, config)).toEqual({ outcome: 'pass' });
  });

  it('passes when there are no priors', () => {
    expect(classifyArtifactStubGuard([], 'id', 1, config)).toEqual({ outcome: 'pass' });
  });

  it('passes when the largest prior is below minPriorBytes', () => {
    const priors: PriorArtifactSibling[] = [{ name: 'a.html', size: 100 }];
    expect(classifyArtifactStubGuard(priors, 'id', 1, config)).toEqual({ outcome: 'pass' });
  });

  it('passes when the new size meets the retained-ratio threshold', () => {
    const priors: PriorArtifactSibling[] = [{ name: 'a.html', size: 10000 }];
    expect(classifyArtifactStubGuard(priors, 'id', 3000, config)).toEqual({ outcome: 'pass' });
  });

  it('warns (mode=warn) when the new size is below threshold, picking the largest of several priors', () => {
    const priors: PriorArtifactSibling[] = [
      { name: 'small.html', size: 5000 },
      { name: 'big.html', size: 10000 },
    ];
    const result = classifyArtifactStubGuard(priors, 'id', 100, config);
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
    const result = classifyArtifactStubGuard(priors, 'id', 100, { ...config, mode: 'reject' });
    expect(result.outcome).toBe('reject');
    expect(result.warning).toBeDefined();
  });
});

describe('ArtifactRegressionError', () => {
  it('carries the regression details', () => {
    const err = new ArtifactRegressionError('shrunk', {
      identifier: 'id',
      newSize: 10,
      priorSize: 5000,
      priorName: 'a.html',
    });
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
    expect(readArtifactStubGuardConfigFromEnv({})).toEqual(DEFAULT_ARTIFACT_STUB_GUARD_CONFIG);
  });

  it('reads a valid mode/ratio/minPriorBytes from env', () => {
    const config = readArtifactStubGuardConfigFromEnv({
      ARTIFACT_STUB_GUARD: 'reject',
      ARTIFACT_STUB_GUARD_MIN_RATIO: '0.5',
      ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES: '2048',
    });
    expect(config.mode).toBe('reject');
    expect(config.minRetainedRatio).toBe(0.5);
    expect(config.minPriorBytes).toBe(2048);
  });

  it('accepts "warn" and "off" modes too', () => {
    expect(readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD: 'warn' }).mode).toBe('warn');
    expect(readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD: 'off' }).mode).toBe('off');
  });

  it('falls back to the default mode for an unrecognized value', () => {
    expect(readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD: 'bogus' }).mode).toBe(
      DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.mode,
    );
  });

  it('falls back to the default ratio for out-of-range or non-numeric values', () => {
    expect(readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD_MIN_RATIO: '0' }).minRetainedRatio).toBe(
      DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minRetainedRatio,
    );
    expect(readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD_MIN_RATIO: '1.5' }).minRetainedRatio).toBe(
      DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minRetainedRatio,
    );
    expect(readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD_MIN_RATIO: 'nope' }).minRetainedRatio).toBe(
      DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minRetainedRatio,
    );
    expect(readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD_MIN_RATIO: '1' }).minRetainedRatio).toBe(1);
  });

  it('falls back to the default minPriorBytes for a non-positive or non-integer value', () => {
    expect(
      readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES: '0' }).minPriorBytes,
    ).toBe(DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minPriorBytes);
    expect(
      readArtifactStubGuardConfigFromEnv({ ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES: '1.5' }).minPriorBytes,
    ).toBe(DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.minPriorBytes);
  });

  it('uses process.env by default', () => {
    const config = readArtifactStubGuardConfigFromEnv();
    expect(config.mode).toBe(DEFAULT_ARTIFACT_STUB_GUARD_CONFIG.mode);
  });

  it('preserves siblingExtensions from the supplied defaults', () => {
    const customDefaults: ArtifactStubGuardConfig = {
      ...DEFAULT_ARTIFACT_STUB_GUARD_CONFIG,
      siblingExtensions: ['.md'],
    };
    expect(readArtifactStubGuardConfigFromEnv({}, customDefaults).siblingExtensions).toEqual(['.md']);
  });
});
