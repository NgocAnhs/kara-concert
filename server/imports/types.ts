export type Lease = { jobId: string; leaseToken: string; deadlineAt: string };

export type VideoMetadata = {
  videoId: string;
  title: string;
  durationSeconds: number;
  isPublic: boolean;
  embeddable: boolean;
  isLive: boolean;
  playable: boolean;
  fetchedAt: string;
  expiresAt: string;
};

export type TranscriptLine = { text: string; start: number; end: number };

export type Transcript = { title: string; lines: TranscriptLine[] };

export type PreparedSong = {
  title: string;
  lines: Array<TranscriptLine & {
    vietHan: string;
    romanization: string;
    meaning: string;
  }>;
};
