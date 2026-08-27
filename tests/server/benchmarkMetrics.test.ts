// @vitest-environment node
import { realpath, readFile, readdir } from 'node:fs/promises';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertReferenceOutsideRepository,
  assertReportOutsideRepository,
  matchReferenceCues,
  measureLyrics,
  measureTiming,
  runBenchmarkPlan,
  validateBenchmarkManifest,
  writeBenchmarkReportAtomic,
} from '../../scripts/benchmark-import';
import { ProviderFailure } from '../../server/imports/youtube';

const fixtures: string[] = [];

async function fixture(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  fixtures.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('benchmark lyric metrics', () => {
  it.each([
    ['ABC', 'ADC', 1 / 3],
    ['ABC', 'ABXC', 1 / 3],
    ['ABC', 'AC', 1 / 3],
  ])('counts substitutions, insertions and deletions against the full reference', (reference, actual, expected) => {
    expect(measureLyrics(reference, actual)).toBeCloseTo(expected);
  });

  it('normalizes NFC, case, whitespace and punctuation only for measurement', () => {
    expect(measureLyrics('CAFÉ, 난!', 'cafe\u0301난')).toBe(0);
    expect(measureLyrics('', 'invented')).toBe(8);
  });
});

describe('benchmark timing metrics', () => {
  it('counts a cue only when both boundaries are within half a second', () => {
    expect(measureTiming(
      [{ start: 1, end: 3 }],
      [{ start: 1.4, end: 3.8 }],
    )).toEqual({
      withinHalfSecond: 0,
      deltas: [{ start: 0.3999999999999999, end: 0.7999999999999998 }],
      allWithinOneSecond: true,
    });
  });

  it('keeps missing and mismatched cues as failures instead of dropping hard samples', () => {
    const result = measureTiming(
      [{ start: 1, end: 2 }, { start: 5, end: 7 }],
      [{ start: 1.2, end: 2.2 }],
    );

    expect(result.withinHalfSecond).toBe(1);
    expect(result.deltas).toEqual([
      { start: 0.19999999999999996, end: 0.20000000000000018 },
      { start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY },
    ]);
    expect(result.allWithinOneSecond).toBe(false);
    expect(measureTiming([{ start: 1, end: 2 }], [
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]).allWithinOneSecond).toBe(false);
  });

  it('uses a small epsilon at exact timing thresholds', () => {
    expect(measureTiming([{ start: 0, end: 1 }], [{ start: 0.5000000001, end: 1.5000000001 }]))
      .toMatchObject({ withinHalfSecond: 1, allWithinOneSecond: true });
    expect(measureTiming([{ start: 0, end: 1 }], [{ start: 0.50001, end: 1.50001 }]))
      .toMatchObject({ withinHalfSecond: 0 });
    expect(measureTiming([{ start: 0, end: 1 }], [{ start: 1.0000000001, end: 2.0000000001 }]))
      .toMatchObject({ allWithinOneSecond: true });
    expect(measureTiming([{ start: 0, end: 1 }], [{ start: 1.00001, end: 2.00001 }]))
      .toMatchObject({ allWithinOneSecond: false });
  });

  it('matches selected repeated cues in order across arbitrary transcript splits', () => {
    const matched = matchReferenceCues([
      { text: 'chorus', start: 1, end: 2 },
      { text: 'alpha beta gamma delta epsilon zeta eta', start: 20, end: 27 },
      { text: 'chorus', start: 50, end: 51 },
    ], [
      { text: 'chorus', start: 1, end: 2 },
      { text: 'alpha', start: 20, end: 21 },
      { text: 'beta', start: 21, end: 22 },
      { text: 'gamma', start: 22, end: 23 },
      { text: 'delta', start: 23, end: 24 },
      { text: 'epsilon', start: 24, end: 25 },
      { text: 'zeta', start: 25, end: 26 },
      { text: 'eta', start: 26, end: 27 },
      { text: 'chorus', start: 50, end: 51 },
    ]);

    expect(matched).toEqual([
      { start: 1, end: 2 },
      { start: 20, end: 27 },
      { start: 50, end: 51 },
    ]);
  });

  it('chooses the selected later repeat by its reference timing instead of the earliest text match', () => {
    expect(matchReferenceCues([
      { text: 'chorus', start: 50, end: 52 },
    ], [
      { text: 'chorus', start: 2, end: 4 },
      { text: 'verse', start: 10, end: 12 },
      { text: 'chorus', start: 50, end: 52 },
    ])).toEqual([{ start: 50, end: 52 }]);
  });
});

function validManifest() {
  const profiles = ['pureKorean', 'pureEnglish', 'mixed', 'mixed', 'mixed'];
  return {
    version: 1,
    humanReviewer: 'reviewer-recorded-outside-report',
    referencePreparedBeforeModelOutput: true,
    retentionRightsConfirmed: true,
    samples: profiles.map((languageProfile, sampleIndex) => ({
      id: `sample-${sampleIndex + 1}`,
      videoId: `abcde${sampleIndex}FGHIJ`,
      languageProfile,
      expectedDurationSeconds: sampleIndex === 4 ? 420 : 200,
      features: sampleIndex === 0 ? ['rap'] : sampleIndex === 1 ? ['instrumental'] : ['repeats'],
      referenceLyrics: `synthetic reference ${sampleIndex}`,
      selectedCues: Array.from({ length: 20 }, (_, cueIndex) => ({
        text: `synthetic cue ${sampleIndex}-${cueIndex}`,
        start: (sampleIndex === 4 ? 420 : 200) * cueIndex / 20,
        end: (sampleIndex === 4 ? 420 : 200) * cueIndex / 20 + 2,
      })),
    })),
  };
}

describe('live benchmark safeguards', () => {
  it('requires a complete human-verified five-song reference set', () => {
    expect(validateBenchmarkManifest(validManifest()).samples).toHaveLength(5);

    expect(() => validateBenchmarkManifest({
      ...validManifest(),
      referencePreparedBeforeModelOutput: false,
    })).toThrow(/BENCHMARK_MANIFEST_INVALID/);
    expect(() => validateBenchmarkManifest({
      ...validManifest(),
      samples: validManifest().samples.slice(0, 4),
    })).toThrow(/BENCHMARK_MANIFEST_INVALID/);
    expect(() => validateBenchmarkManifest({
      ...validManifest(),
      samples: validManifest().samples.map((sample) => ({ ...sample, referenceLyrics: '— … !' })),
    })).toThrow(/BENCHMARK_MANIFEST_INVALID/);
    expect(() => validateBenchmarkManifest({
      ...validManifest(),
      samples: validManifest().samples.map((sample) => ({
        ...sample,
        selectedCues: sample.selectedCues.map((cue, index) => ({ ...cue, start: index, end: index + 0.5 })),
      })),
    })).toThrow(/BENCHMARK_MANIFEST_INVALID/);
  });

  it('refuses to write benchmark reports inside the repository', async () => {
    const repository = await fixture('benchmark-repository-');
    const outside = await fixture('benchmark-outside-');
    expect(assertReportOutsideRepository(repository, path.join(outside, 'quality-report.json')))
      .toBe(path.join(await realpath(outside), 'quality-report.json'));
    expect(() => assertReportOutsideRepository(repository, path.join(repository, 'quality-report.json')))
      .toThrow(/BENCHMARK_REPORT_MUST_BE_OUTSIDE_REPOSITORY/);
  });

  it('refuses private human references stored inside the repository', async () => {
    const repository = await fixture('benchmark-repository-');
    const outside = await fixture('benchmark-outside-');
    const reference = path.join(outside, 'rights-cleared-references.json');
    await writeFile(reference, '{}');
    expect(assertReferenceOutsideRepository(repository, reference))
      .toBe(await realpath(reference));
    expect(() => assertReferenceOutsideRepository(repository, path.join(repository, 'references.json')))
      .toThrow(/BENCHMARK_REFERENCE_MUST_BE_OUTSIDE_REPOSITORY/);
  });

  it('resolves symlinked path parents and targets before allowing external files', async () => {
    const repository = await fixture('benchmark-repository-');
    const outside = await fixture('benchmark-outside-');
    await mkdir(path.join(outside, 'to-repository'));
    await symlink(repository, path.join(outside, 'to-repository', 'inside'), 'dir');
    await symlink(repository, path.join(outside, 'manifest-inside.json'));

    expect(() => assertReportOutsideRepository(repository, path.join(outside, 'to-repository', 'inside', 'report.json')))
      .toThrow(/BENCHMARK_REPORT_MUST_BE_OUTSIDE_REPOSITORY/);
    expect(() => assertReferenceOutsideRepository(repository, path.join(outside, 'manifest-inside.json')))
      .toThrow(/BENCHMARK_REFERENCE_MUST_BE_OUTSIDE_REPOSITORY/);
  });

  it('atomically publishes a report outside the repository without overwriting an existing report', async () => {
    const repository = await fixture('benchmark-repository-');
    const outside = await fixture('benchmark-outside-');
    const output = path.join(outside, 'reports', 'result.json');
    await writeBenchmarkReportAtomic(repository, output, { featureMayBeEnabled: false, results: [] });

    await expect(readFile(output, 'utf8')).resolves.toContain('"featureMayBeEnabled": false');
    await expect(readdir(path.dirname(output))).resolves.toEqual(['result.json']);
    await expect(writeBenchmarkReportAtomic(repository, output, { overwritten: true })).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('keeps planned non-quota runs after a failure and stops safely on quota exhaustion', async () => {
    const manifest = validateBenchmarkManifest(validManifest());
    const continuing = vi.fn(async (sample: { id: string }, run: number) => {
      if (sample.id === 'sample-1' && run === 1) throw new ProviderFailure('PROVIDER_TRANSIENT');
      return { sampleId: sample.id, run };
    });
    const continued = await runBenchmarkPlan(manifest.samples, continuing);
    expect(continuing).toHaveBeenCalledTimes(10);
    expect(continued.results).toHaveLength(10);
    expect(continued.results[0]).toMatchObject({ attempted: true, outcome: 'failed', errorCode: 'PROVIDER_TRANSIENT' });

    const quota = vi.fn(async () => { throw new ProviderFailure('PROVIDER_QUOTA'); });
    const stopped = await runBenchmarkPlan(manifest.samples, quota);
    expect(quota).toHaveBeenCalledTimes(1);
    expect(stopped.results).toHaveLength(10);
    expect(stopped.results[0]).toMatchObject({ attempted: true, outcome: 'failed', errorCode: 'PROVIDER_QUOTA' });
    expect(stopped.results.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ attempted: false, outcome: 'skipped', errorCode: 'BENCHMARK_SKIPPED_QUOTA_PROTECTION' }),
    ]));

    const timeout = vi.fn(async () => { throw new DOMException('timed out', 'AbortError'); });
    const timedOut = await runBenchmarkPlan(manifest.samples, timeout);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timedOut.results[0]).toMatchObject({ attempted: true, outcome: 'failed', errorCode: 'BENCHMARK_TIMEOUT' });
    expect(timedOut.results.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ attempted: false, outcome: 'skipped', errorCode: 'BENCHMARK_SKIPPED_QUOTA_PROTECTION' }),
    ]));

    const providerTimeout = vi.fn(async () => { throw new ProviderFailure('PROVIDER_TIMEOUT'); });
    const providerTimedOut = await runBenchmarkPlan(manifest.samples, providerTimeout);
    expect(providerTimeout).toHaveBeenCalledTimes(1);
    expect(providerTimedOut.results[0]).toMatchObject({ attempted: true, outcome: 'failed', errorCode: 'PROVIDER_TIMEOUT' });
    expect(providerTimedOut.results.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ attempted: false, outcome: 'skipped', errorCode: 'BENCHMARK_SKIPPED_QUOTA_PROTECTION' }),
    ]));
  });
});
