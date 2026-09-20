import type { TraceEvent, TraceEventBody } from './types.js';

/** In-memory trace for one trial. `step` is advanced by the session runner on every model turn. */
export class Trace {
  readonly events: TraceEvent[] = [];
  step = 0;

  constructor(private readonly onEvent?: (e: TraceEvent) => void) {}

  push(body: TraceEventBody): TraceEvent {
    const e: TraceEvent = { ...body, ts: Date.now() };
    this.events.push(e);
    this.onEvent?.(e);
    return e;
  }
}
