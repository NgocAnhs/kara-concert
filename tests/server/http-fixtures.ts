import { PassThrough } from 'node:stream';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export function request(method = 'POST', body: string | Buffer = '{}', headers: Record<string, string | string[] | undefined> = {}): VercelRequest {
  const stream = new PassThrough();
  Object.assign(stream, {
    method,
    headers: { origin: 'https://app.test', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  });
  stream.end(body);
  return stream as unknown as VercelRequest;
}
export function response() {
  const headers: Record<string, string | number | readonly string[]> = {};
  let statusCode = 200;
  let body = '';
  const res = {
    get statusCode() { return statusCode; },
    set statusCode(value: number) { statusCode = value; },
    setHeader(name: string, value: string | number | readonly string[]) { headers[name.toLowerCase()] = value; return res; },
    end(value = '') { body = value; return res; },
    status(value: number) { statusCode = value; return res; },
    json(value: unknown) { body = JSON.stringify(value); return res; },
  };
  return { res: res as unknown as VercelResponse, headers, get status() { return statusCode; }, get body() { return body; }, json: () => JSON.parse(body) };
}
