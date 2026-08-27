import { existsSync, realpathSync } from 'node:fs';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGeminiProvider, validatePreparedSong } from '../server/imports/gemini.js';
import { splitLyric } from '../server/imports/lyrics.js';
import type { PreparedSong, TranscriptLine } from '../server/imports/types.js';
import { createYouTubeProvider, ProviderFailure } from '../server/imports/youtube.js';

export type Cue = { start: number; end: number };
export type TimingMeasurement = {
  withinHalfSecond: number;
  deltas: Cue[];
  allWithinOneSecond: boolean;
};

function normalizeLyrics(value: string): string[] {
  return Array.from(value.normalize('NFC').toLocaleLowerCase('und').replace(/[\p{P}\p{Z}\s]/gu, ''));
}

export type ReferenceCue = Cue & { text: string };
export type BenchmarkSample = {
  id: string;
  videoId: string;
  languageProfile: 'pureKorean' | 'pureEnglish' | 'mixed';
  expectedDurationSeconds: number;
  features: Array<'rap' | 'instrumental' | 'repeats'>;
  referenceLyrics: string;
  selectedCues: ReferenceCue[];
};
export type BenchmarkManifest = {
  version: 1;
  humanReviewer: string;
  referencePreparedBeforeModelOutput: true;
  retentionRightsConfirmed: true;
  samples: BenchmarkSample[];
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function invalidManifest(): never { throw new Error('BENCHMARK_MANIFEST_INVALID'); }

export function validateBenchmarkManifest(value: unknown): BenchmarkManifest {
  const root = object(value);
  if (!root || root.version !== 1 || typeof root.humanReviewer !== 'string' || !root.humanReviewer.trim()
    || root.referencePreparedBeforeModelOutput !== true || root.retentionRightsConfirmed !== true
    || !Array.isArray(root.samples) || root.samples.length !== 5) invalidManifest();

  const samples: BenchmarkSample[] = root.samples.map((rawSample) => {
    const sample = object(rawSample);
    if (!sample || typeof sample.id !== 'string' || !sample.id.trim()
      || typeof sample.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(sample.videoId)
      || !['pureKorean', 'pureEnglish', 'mixed'].includes(String(sample.languageProfile))
      || typeof sample.expectedDurationSeconds !== 'number' || !Number.isFinite(sample.expectedDurationSeconds)
      || sample.expectedDurationSeconds <= 0 || sample.expectedDurationSeconds > 480
      || typeof sample.referenceLyrics !== 'string' || normalizeLyrics(sample.referenceLyrics).length === 0
      || !Array.isArray(sample.features)
      || sample.features.some((feature) => !['rap', 'instrumental', 'repeats'].includes(String(feature)))
      || !Array.isArray(sample.selectedCues) || sample.selectedCues.length < 20) invalidManifest();

    let priorEnd = -1;
    const selectedCues: ReferenceCue[] = sample.selectedCues.map((rawCue) => {
      const cue = object(rawCue);
      if (!cue || typeof cue.text !== 'string' || normalizeLyrics(cue.text).length === 0
        || typeof cue.start !== 'number' || !Number.isFinite(cue.start)
        || typeof cue.end !== 'number' || !Number.isFinite(cue.end)
        || cue.start < 0 || cue.end <= cue.start || cue.end > sample.expectedDurationSeconds || cue.start < priorEnd) invalidManifest();
      priorEnd = cue.end;
      return { text: cue.text, start: cue.start, end: cue.end };
    });
    return {
      id: sample.id,
      videoId: sample.videoId,
      languageProfile: sample.languageProfile as BenchmarkSample['languageProfile'],
      expectedDurationSeconds: sample.expectedDurationSeconds,
      features: sample.features as BenchmarkSample['features'],
      referenceLyrics: sample.referenceLyrics,
      selectedCues,
    };
  });

  const profiles = samples.map((sample) => sample.languageProfile);
  const features = new Set(samples.flatMap((sample) => sample.features));
  if (new Set(samples.map((sample) => sample.id)).size !== 5
    || new Set(samples.map((sample) => sample.videoId)).size !== 5
    || profiles.filter((profile) => profile === 'pureKorean').length !== 1
    || profiles.filter((profile) => profile === 'pureEnglish').length !== 1
    || profiles.filter((profile) => profile === 'mixed').length !== 3
    || !['rap', 'instrumental', 'repeats'].every((feature) => features.has(feature as BenchmarkSample['features'][number]))
    || !samples.some((sample) => sample.expectedDurationSeconds >= 360)
    || samples.some((sample) => new Set(sample.selectedCues.map((cue) => Math.min(2, Math.floor(cue.start / sample.expectedDurationSeconds * 3)))).size !== 3)) invalidManifest();

  return {
    version: 1,
    humanReviewer: root.humanReviewer,
    referencePreparedBeforeModelOutput: true,
    retentionRightsConfirmed: true,
    samples,
  };
}

function resolvedPath(candidate: string, mustExist: boolean): string {
  let current = path.resolve(candidate);
  const missing: string[] = [];
  while (!existsSync(current)) {
    if (mustExist || path.dirname(current) === current) throw new Error('BENCHMARK_PATH_UNRESOLVABLE');
    missing.unshift(path.basename(current));
    current = path.dirname(current);
  }
  return path.join(realpathSync(current), ...missing);
}

function assertPathOutsideRepository(repository: string, candidate: string, errorCode: string, mustExist: boolean): string {
  const root = realpathSync(path.resolve(repository));
  let resolved: string;
  try { resolved = resolvedPath(candidate, mustExist); } catch { throw new Error(errorCode); }
  const relative = path.relative(root, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..')) {
    throw new Error(errorCode);
  }
  return resolved;
}

export function assertReportOutsideRepository(repository: string, report: string): string {
  return assertPathOutsideRepository(repository, report, 'BENCHMARK_REPORT_MUST_BE_OUTSIDE_REPOSITORY', false);
}

export function assertReferenceOutsideRepository(repository: string, reference: string): string {
  return assertPathOutsideRepository(repository, reference, 'BENCHMARK_REFERENCE_MUST_BE_OUTSIDE_REPOSITORY', true);
}

function editDistance(reference: string[], actual: string[]): number {
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let referenceIndex = 0; referenceIndex < reference.length; referenceIndex += 1) {
    const current = [referenceIndex + 1];
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
      current.push(Math.min(
        previous[actualIndex + 1]! + 1,
        current[actualIndex]! + 1,
        previous[actualIndex]! + (reference[referenceIndex] === actual[actualIndex] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous[actual.length]!;
}

export function measureLyrics(reference: string, actual: string): number {
  const normalizedReference = normalizeLyrics(reference);
  const normalizedActual = normalizeLyrics(actual);
  return editDistance(normalizedReference, normalizedActual) / Math.max(1, normalizedReference.length);
}

export function measureTiming(referenceCues: Cue[], actualCues: Cue[]): TimingMeasurement {
  const epsilon = 1e-9;
  const deltas = referenceCues.map((reference, index) => {
    const actual = actualCues[index];
    return actual
      ? { start: Math.abs(reference.start - actual.start), end: Math.abs(reference.end - actual.end) }
      : { start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY };
  });
  return {
    withinHalfSecond: deltas.filter(({ start, end }) => start <= 0.5 + epsilon && end <= 0.5 + epsilon).length,
    deltas,
    allWithinOneSecond: referenceCues.length === actualCues.length
      && deltas.every(({ start, end }) => start <= 1 + epsilon && end <= 1 + epsilon),
  };
}

export function matchReferenceCues(referenceCues: ReferenceCue[], actualLines: TranscriptLine[]): Cue[] {
  const characters = actualLines.flatMap((line) => normalizeLyrics(line.text).map((character) => ({
    character, start: line.start, end: line.end,
  })));
  let cursor = 0;
  return referenceCues.map((reference) => {
    const wanted = normalizeLyrics(reference.text);
    let closest: { start: number; end: number; characterEnd: number; distance: number } | undefined;
    for (let start = cursor; start + wanted.length <= characters.length; start += 1) {
      if (wanted.every((character, offset) => characters[start + offset]!.character === character)) {
        const end = start + wanted.length - 1;
        const candidate = { start: characters[start]!.start, end: characters[end]!.end };
        const distance = Math.abs(candidate.start - reference.start) + Math.abs(candidate.end - reference.end);
        if (!closest || distance < closest.distance) {
          closest = { ...candidate, characterEnd: end, distance };
        }
      }
    }
    if (!closest) return { start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY };
    cursor = closest.characterEnd + 1;
    return { start: closest.start, end: closest.end };
  });
}

function literalSegmentsPreserved(song: PreparedSong): boolean {
  return song.lines.every((line) => {
    const literals = splitLyric(line.text)
      .filter((segment) => segment.kind === 'literal' && /\p{Script=Latin}/u.test(segment.text))
      .map((segment) => segment.text);
    return [line.vietHan, line.romanization].every((reading) => {
      let cursor = 0;
      return literals.every((literal) => {
        const found = reading.indexOf(literal, cursor);
        if (found < 0) return false;
        cursor = found + literal.length;
        return true;
      });
    });
  });
}

type Usage = {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  finishReasons: string[];
  responseCount: number;
  responseCountWithActualUsage: number;
};

function usageForReport(usage: Usage): Usage & { telemetryStatus: 'RECORDED' | 'INCOMPLETE' | 'UNAVAILABLE_PRE_RESPONSE_FAILURE' } {
  return {
    ...usage,
    telemetryStatus: usage.responseCount === 0
      ? 'UNAVAILABLE_PRE_RESPONSE_FAILURE'
      : usage.responseCount === usage.responseCountWithActualUsage ? 'RECORDED' : 'INCOMPLETE',
  };
}

function recordTelemetry(usage: Usage, telemetry: { promptTokens?: number; outputTokens?: number; totalTokens?: number; finishReasons: string[] }): void {
  usage.responseCount += 1;
  usage.finishReasons.push(...telemetry.finishReasons);
  if (typeof telemetry.promptTokens === 'number' && typeof telemetry.outputTokens === 'number' && typeof telemetry.totalTokens === 'number') {
    usage.promptTokens += telemetry.promptTokens;
    usage.outputTokens += telemetry.outputTokens;
    usage.totalTokens += telemetry.totalTokens;
    usage.responseCountWithActualUsage += 1;
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`BENCHMARK_ENV_MISSING_${key}`);
  return value;
}

class BenchmarkRunError extends Error {
  constructor(
    readonly code: string,
    readonly elapsedMs: number,
    readonly usage: ReturnType<typeof usageForReport>,
  ) {
    super(code);
  }
}

function safeErrorCode(error: unknown, timedOut = false): string {
  if (timedOut) return 'BENCHMARK_TIMEOUT';
  if (error instanceof Error && error.name === 'AbortError') return 'BENCHMARK_TIMEOUT';
  if (error instanceof ProviderFailure) return error.code;
  if (error instanceof BenchmarkRunError) return error.code;
  if (error instanceof Error && ['INVALID_PREPARED_SONG', 'BENCHMARK_TELEMETRY_MISSING'].includes(error.message)) return error.message;
  return 'BENCHMARK_RUN_FAILED';
}

function shouldContinueAfterFailure(code: string): boolean {
  return code !== 'PROVIDER_QUOTA' && code !== 'PROVIDER_TIMEOUT' && code !== 'BENCHMARK_TIMEOUT';
}

type BenchmarkSuccessfulRun = {
  sampleId: string;
  videoId: string;
  run: number;
  elapsedMs: number;
  durationSeconds: number;
  durationMatchesReference: boolean;
  usage: ReturnType<typeof usageForReport>;
  characterErrorRate: number;
  selectedCueCount: number;
  cuesWithinHalfSecond: number;
  timingRate: number;
  allCuesWithinOneSecond: boolean;
  englishCopy100: boolean;
  automatedThresholdsPassed: boolean;
  humanLineIntegrityReview: 'REQUIRED';
  humanKoreanReadingMeaningReview: 'REQUIRED';
  reviewData: PreparedSong;
};

async function benchmarkRun(sample: BenchmarkSample, runNumber: number, env: NodeJS.ProcessEnv): Promise<BenchmarkSuccessfulRun> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + 240_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  const usage: Usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0, finishReasons: [], responseCount: 0, responseCountWithActualUsage: 0 };
  try {
    const metadata = await createYouTubeProvider({ apiKey: requiredEnv(env, 'YOUTUBE_DATA_API_KEY') })
      .fetchVideo(sample.videoId, { signal: controller.signal });
    const gemini = createGeminiProvider({
      apiKey: requiredEnv(env, 'GEMINI_API_KEY'),
      model: requiredEnv(env, 'GEMINI_MODEL'),
      deadlineAt,
      onResponseTelemetry: (telemetry) => recordTelemetry(usage, telemetry),
    });
    const transcript = await gemini.transcribe(`https://www.youtube.com/watch?v=${sample.videoId}`, { signal: controller.signal });
    const prepared = validatePreparedSong(await gemini.enrich(transcript, { signal: controller.signal }), metadata.durationSeconds);
    const elapsedMs = Date.now() - startedAt;
    if (usage.responseCount !== 2 || usage.responseCountWithActualUsage !== 2 || usage.finishReasons.length !== 2) {
      throw new Error('BENCHMARK_TELEMETRY_MISSING');
    }
    const durationMatchesReference = Math.abs(metadata.durationSeconds - sample.expectedDurationSeconds) <= 1;
    const characterErrorRate = measureLyrics(sample.referenceLyrics, transcript.lines.map((line) => line.text).join('\n'));
    const timing = measureTiming(sample.selectedCues, matchReferenceCues(sample.selectedCues, transcript.lines));
    const timingRate = timing.withinHalfSecond / sample.selectedCues.length;
    const englishCopy100 = literalSegmentsPreserved(prepared);
    return {
      sampleId: sample.id,
      videoId: sample.videoId,
      run: runNumber,
      elapsedMs,
      durationSeconds: metadata.durationSeconds,
      durationMatchesReference,
      usage: usageForReport(usage),
      characterErrorRate,
      selectedCueCount: sample.selectedCues.length,
      cuesWithinHalfSecond: timing.withinHalfSecond,
      timingRate,
      allCuesWithinOneSecond: timing.allWithinOneSecond,
      englishCopy100,
      automatedThresholdsPassed: durationMatchesReference && characterErrorRate <= 0.05 && timingRate >= 0.9
        && timing.allWithinOneSecond && englishCopy100 && elapsedMs <= 240_000,
      humanLineIntegrityReview: 'REQUIRED',
      humanKoreanReadingMeaningReview: 'REQUIRED',
      reviewData: prepared,
    };
  } catch (error) {
    throw new BenchmarkRunError(safeErrorCode(error, controller.signal.aborted), Date.now() - startedAt, usageForReport(usage));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export type BenchmarkPlanResult<T> =
  | { sampleId: string; videoId: string; run: number; attempted: true; outcome: 'success'; value: T }
  | { sampleId: string; videoId: string; run: number; attempted: true; outcome: 'failed'; errorCode: string; elapsedMs?: number; usage?: ReturnType<typeof usageForReport> }
  | { sampleId: string; videoId: string; run: number; attempted: false; outcome: 'skipped'; errorCode: 'BENCHMARK_SKIPPED_QUOTA_PROTECTION' };

export async function runBenchmarkPlan<T>(
  samples: BenchmarkSample[],
  runOne: (sample: BenchmarkSample, runNumber: number) => Promise<T>,
): Promise<{ results: Array<BenchmarkPlanResult<T>> }> {
  const results: Array<BenchmarkPlanResult<T>> = [];
  let stopForQuotaProtection = false;
  for (const sample of samples) {
    for (let run = 1; run <= 2; run += 1) {
      if (stopForQuotaProtection) {
        results.push({ sampleId: sample.id, videoId: sample.videoId, run, attempted: false, outcome: 'skipped', errorCode: 'BENCHMARK_SKIPPED_QUOTA_PROTECTION' });
        continue;
      }
      try {
        results.push({ sampleId: sample.id, videoId: sample.videoId, run, attempted: true, outcome: 'success', value: await runOne(sample, run) });
      } catch (error) {
        const code = safeErrorCode(error);
        const detail = error instanceof BenchmarkRunError ? { elapsedMs: error.elapsedMs, usage: error.usage } : {};
        results.push({ sampleId: sample.id, videoId: sample.videoId, run, attempted: true, outcome: 'failed', errorCode: code, ...detail });
        stopForQuotaProtection = !shouldContinueAfterFailure(code);
      }
    }
  }
  return { results };
}

export async function writeBenchmarkReportAtomic(projectRoot: string, output: string, report: object): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  const verifiedOutput = assertReportOutsideRepository(projectRoot, output);
  const temporary = path.join(path.dirname(verifiedOutput), `.${path.basename(verifiedOutput)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' });
    await link(temporary, verifiedOutput);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function parseArguments(args: string[]): { manifest: string; output: string } {
  if (args[0] !== '--run-live') throw new Error('LIVE_BENCHMARK_REQUIRES_EXPLICIT_RUN_LIVE');
  if (args.length !== 5 || args[1] !== '--manifest' || args[3] !== '--output' || !args[2] || !args[4]) {
    throw new Error('LIVE_BENCHMARK_USAGE');
  }
  return { manifest: path.resolve(args[2]), output: args[4] };
}

async function run(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = parseArguments(process.argv.slice(2));
  const output = assertReportOutsideRepository(projectRoot, args.output);
  const manifestPath = assertReferenceOutsideRepository(projectRoot, args.manifest);
  const manifest = validateBenchmarkManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  requiredEnv(process.env, 'YOUTUBE_DATA_API_KEY');
  requiredEnv(process.env, 'GEMINI_API_KEY');
  const model = requiredEnv(process.env, 'GEMINI_MODEL');
  const plan = await runBenchmarkPlan(manifest.samples, (sample, runNumber) => benchmarkRun(sample, runNumber, process.env));
  const results = plan.results.map((entry) => entry.outcome === 'success'
    ? { attempted: true, outcome: 'success', ...entry.value }
    : entry);
  const incomplete = plan.results.some((entry) => entry.outcome !== 'success');
  await writeBenchmarkReportAtomic(projectRoot, output, {
    generatedAt: new Date().toISOString(),
    model,
    promptVersion: 'youtube-import-v1',
    intendedRunCount: 10,
    attemptedRunCount: plan.results.filter((entry) => entry.attempted).length,
    failedRunCount: plan.results.filter((entry) => entry.outcome === 'failed').length,
    skippedRunCount: plan.results.filter((entry) => entry.outcome === 'skipped').length,
    featureMayBeEnabled: false,
    featureGate: incomplete ? 'BLOCKED_BENCHMARK_RUN_FAILURE' : 'BLOCKED_PENDING_HUMAN_RESULT_REVIEW',
    results,
  });
  console.log(`Live benchmark report written outside repository: ${output}`);
  if (incomplete) throw new Error('BENCHMARK_RUNS_INCOMPLETE');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : 'LIVE_BENCHMARK_FAILED');
    process.exitCode = 1;
  });
}
