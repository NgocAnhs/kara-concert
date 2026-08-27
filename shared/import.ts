export type JobStatus = 'checking_video' | 'transcribing' | 'enriching'
  | 'completed' | 'failed' | 'expired';

export type PublicJob = {
  jobId: string;
  status: JobStatus;
  stage: JobStatus;
  deadlineAt: string;
  songId?: string;
  errorCode?: string;
};

export type ImportReply =
  | { songId: string }
  | { jobId: string; status: JobStatus; statusUrl: string };
