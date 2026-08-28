import type { PublicJob } from '../../../shared/import';
import { ImportClientError } from './client';

function retryDelay(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 1) return 'khi hạn mức được làm mới';
  let remaining = Math.ceil(seconds);
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const parts = [
    hours > 0 ? `${hours} giờ` : '',
    minutes > 0 ? `${minutes} phút` : '',
    secs > 0 ? `${secs} giây` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

export function admissionFailureMessage(reason: unknown): string {
  if (!(reason instanceof ImportClientError)) return 'Không thể tiếp nhận liên kết này. Hãy kiểm tra lại và thử lại.';
  if (reason.code === 'ACTIVE_LIMIT') {
    return `Hệ thống đang xử lý số tác vụ tối đa. Có thể thử lại sau ${retryDelay(reason.retryAfter)}.`;
  }
  if (reason.status === 503) return 'Chức năng thêm bài chưa sẵn sàng.';
  return 'Không thể tiếp nhận liên kết này. Hãy kiểm tra lại và thử lại.';
}

export function terminalJobMessage(job: PublicJob): string | null {
  if (job.status === 'expired') return 'Tác vụ đã hết thời gian xử lý. Hãy thêm lại liên kết để tạo một tác vụ mới.';
  if (job.status !== 'failed') return null;
  if (job.errorCode === 'VIDEO_UNAVAILABLE') return 'Video không còn công khai, không cho phép nhúng hoặc không thể phát. Hãy chọn video khác.';
  if (job.errorCode === 'PROVIDER_QUOTA') return 'Dịch vụ AI đang hết hạn mức. Hãy quay lại sau và tạo một tác vụ mới.';
  if (job.errorCode === 'PROVIDER_TIMEOUT') return 'Dịch vụ xử lý đã quá thời gian. Hãy tạo một tác vụ mới để thử lại.';
  if (job.errorCode === 'PROVIDER_TRANSIENT') return 'Dịch vụ xử lý đang tạm thời gián đoạn. Hãy tạo một tác vụ mới để thử lại.';
  return 'Không thể tạo bài hát này. Hãy thêm lại liên kết để tạo một tác vụ mới.';
}
