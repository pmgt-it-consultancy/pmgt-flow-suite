/** Numeric labels keep the retained profiling data free of payloads and IDs. */
export enum SyncPhase {
  PullNetwork = 1,
  PullMap = 2,
  ApplyPreparation = 3,
  ApplyAndReadLocal = 4,
  PushMap = 5,
  PushNetwork = 6,
  SynchronizeTotal = 7,
}

export type SyncSample = {
  phase: SyncPhase;
  page: number;
  durationMs: number;
  rows: number;
  succeeded: number;
};

const CAPACITY = 256;
const noop = (_rows = 0, _succeeded = true) => {};

/** Local, opt-in release profiling; never logs or uploads samples. */
class SyncDiagnostics {
  private enabled = false;
  private generation = 0;
  private samples: SyncSample[] = [];
  private next = 0;

  enable(): void {
    this.disable();
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.generation++;
    this.samples = [];
    this.next = 0;
  }

  snapshot(): SyncSample[] {
    const ordered =
      this.samples.length < CAPACITY
        ? this.samples
        : [...this.samples.slice(this.next), ...this.samples.slice(0, this.next)];
    return ordered.map((sample) => ({ ...sample }));
  }

  begin(phase: SyncPhase, page: number): (rows?: number, succeeded?: boolean) => void {
    if (!this.enabled) return noop;
    const generation = this.generation;
    const start = performance.now();
    let finished = false;
    return (rows = 0, succeeded = true) => {
      if (finished || !this.enabled || generation !== this.generation) return;
      finished = true;
      const durationMs = performance.now() - start;
      if (![phase, page, rows, durationMs].every(Number.isFinite)) return;
      this.samples[this.next] = {
        phase,
        page,
        rows,
        durationMs: Math.max(0, durationMs),
        succeeded: succeeded ? 1 : 0,
      };
      this.next = (this.next + 1) % CAPACITY;
    };
  }
}

export const syncDiagnostics = new SyncDiagnostics();

// Expo inlines this explicit public flag into an opt-in profiling build.
if (process.env.EXPO_PUBLIC_POS_PERF === "1") {
  syncDiagnostics.enable();
  Object.defineProperty(globalThis, "__POS_SYNC_PERF__", {
    configurable: true,
    value: Object.freeze({
      enable: () => syncDiagnostics.enable(),
      disable: () => syncDiagnostics.disable(),
      snapshot: () => syncDiagnostics.snapshot(),
    }),
  });
}
