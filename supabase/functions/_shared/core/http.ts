/** fetch with timeout and bounded retries on network errors, 429 and 5xx. */
export interface RetryOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOptions = {}): Promise<Response> {
  const { timeoutMs = 15_000, retries = 2, baseDelayMs = 400, fetchImpl = fetch } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastError = new HttpError(res.status, `HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      lastError = e;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
    await sleep(baseDelayMs * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
