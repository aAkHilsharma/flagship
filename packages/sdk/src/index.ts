import {
  configSnapshotSchema,
  type ConfigSnapshot,
  type FlagDefinition,
} from '@flagship/contracts';
import { evaluate } from '@flagship/evaluator';
// Keep the public npm package self-contained; consumers don't need monorepo packages.
export type UserContext = {
  key: string;
  attributes: Record<string, string | number | boolean | (string | number | boolean)[]>;
};
export type Evaluation = {
  value: boolean;
  reason: 'DEFAULT' | 'DISABLED' | 'RULE' | 'ROLLOUT_EXCLUDED' | 'FALLBACK';
  ruleId?: string;
};
export interface FlagshipOptions {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  onError?: (error: Error) => void;
  onUpdate?: (revision: number) => void;
}
export class FlagshipClient {
  private snapshot?: ConfigSnapshot;
  private flags = new Map<string, FlagDefinition>();
  private controller?: AbortController;
  private task?: Promise<void>;
  private started = false;
  private connected = false;
  private revoked = false;
  constructor(private readonly options: FlagshipOptions) {}
  get status() {
    return {
      connected: this.connected,
      ready: !!this.snapshot,
      revision: this.snapshot?.revision ?? null,
      revoked: this.revoked,
    };
  }
  private report(error: unknown) {
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
  private accept(value: unknown) {
    const next = configSnapshotSchema.parse(value);
    if (this.snapshot && next.applicationId !== this.snapshot.applicationId)
      throw new Error('Configuration application changed');
    if (this.snapshot && next.revision <= this.snapshot.revision) return;
    const nextFlags = new Map(next.flags.map((f) => [f.key, f]));
    this.snapshot = next;
    this.flags = nextFlags;
    this.options.onUpdate?.(next.revision);
  }
  private invalidate() {
    this.revoked = true;
    this.snapshot = undefined;
    this.flags = new Map();
    this.connected = false;
  }
  private async request(path: string, signal: AbortSignal) {
    const response = await fetch(this.options.baseUrl.replace(/\/$/, '') + path, {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      signal,
    });
    if (response.status === 401 || response.status === 403) {
      this.invalidate();
      throw new Error('SDK credentials rejected');
    }
    if (!response.ok) throw new Error(`Flagship returned HTTP ${response.status}`);
    return response;
  }
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.revoked = false;
    this.controller = new AbortController();
    try {
      const signal = AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(this.options.requestTimeoutMs ?? 5000),
      ]);
      const response = await this.request('/config', signal);
      this.accept(await response.json());
    } catch (error) {
      if (!this.controller.signal.aborted) this.report(error);
    }
    if (!this.controller.signal.aborted && !this.revoked)
      this.task = this.listen(this.controller.signal);
  }
  private async listen(signal: AbortSignal) {
    let attempts = 0;
    while (!signal.aborted && !this.revoked) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const connection = new AbortController();
      const touch = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => connection.abort(), 20000);
      };
      try {
        touch();
        const response = await this.request(
          '/stream',
          AbortSignal.any([signal, connection.signal]),
        );
        if (!response.body) throw new Error('Missing event stream');
        if (!response.headers.get('content-type')?.includes('text/event-stream'))
          throw new Error('Expected an SSE response');
        this.connected = true;
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!signal.aborted && !this.revoked) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 4 * 1024 * 1024)
            throw new Error('Configuration stream exceeded maximum event size');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const lines = frame.split('\n'),
              event = lines
                .find((l) => l.startsWith('event:'))
                ?.slice(6)
                .trim();
            if (event === 'revoked') {
              this.invalidate();
              break;
            }
            if (event === 'config') {
              const data = lines
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trimStart())
                .join('\n');
              this.accept(JSON.parse(data));
              attempts = 0;
            }
          }
        }
      } catch (error) {
        if (!signal.aborted && !this.revoked) this.report(error);
      } finally {
        this.connected = false;
        clearTimeout(watchdog);
        await reader?.cancel().catch(() => {});
        connection.abort();
      }
      if (signal.aborted || this.revoked) break;
      const delay =
        Math.min((this.options.reconnectDelayMs ?? 500) * 2 ** Math.min(attempts++, 6), 30000) +
        Math.random() * 200;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, delay);
        signal.addEventListener('abort', done, { once: true });
        if (signal.aborted) done();
      });
      // Each new stream starts with a complete snapshot, repairing missed events.
    }
  }
  evaluate(key: string, context: UserContext, defaultValue: boolean): Evaluation {
    return evaluate(this.flags.get(key), context, defaultValue);
  }
  isEnabled(key: string, context: UserContext, defaultValue = false): boolean {
    return this.evaluate(key, context, defaultValue).value;
  }
  async close() {
    this.controller?.abort();
    await this.task;
    this.started = false;
    this.connected = false;
  }
}
