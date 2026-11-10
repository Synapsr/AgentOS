import type { Event } from "@agentos/protocol";
import { appendLine, loadLines, writeLines } from "./disk.js";

/** An event before the log has numbered and dated it. */
export type EventInput = Event extends infer E ? (E extends Event ? Omit<E, "seq" | "at"> : never) : never;

/** How many events a reconnecting client can catch up on. Older ones are dropped. */
const KEEP = 5000;

/**
 * The event log: every change, numbered. `seq` only ever grows, across
 * restarts too, so a client can say "I stopped at 812" and get the rest.
 */
export class EventLog {
  private events: Event[];
  private last: number;
  /** Lines in the file, which is rewritten once it holds twice what we keep. */
  private lines: number;

  constructor(
    private readonly path: string,
    private readonly keep = KEEP,
  ) {
    const stored = loadLines<Event>(path);
    this.lines = stored.length;
    this.events = stored.slice(-keep);
    this.last = stored.at(-1)?.seq ?? 0;
  }

  /** Sequence number of the latest event, 0 when nothing ever happened. */
  get seq(): number {
    return this.last;
  }

  /** Numbers, dates and stores an event. */
  append(input: EventInput): Event {
    const event = { ...input, seq: ++this.last, at: Date.now() } as Event;
    this.events.push(event);
    if (this.events.length > this.keep) this.events.shift();
    if (++this.lines >= this.keep * 2) {
      writeLines(this.path, this.events);
      this.lines = this.events.length;
    } else {
      appendLine(this.path, event);
    }
    return event;
  }

  /** The latest event of a type, if the log still has one. */
  latest<Type extends Event["type"]>(type: Type): Extract<Event, { type: Type }> | null {
    return (this.events.findLast((event) => event.type === type) as Extract<Event, { type: Type }> | undefined) ?? null;
  }

  /**
   * Events after `seq`, oldest first. Null when they cannot be served —
   * `seq` is older than what we kept, or comes from another log — and the
   * client must reload everything instead.
   */
  since(seq: number): Event[] | null {
    if (seq > this.last) return null;
    if (seq === this.last) return [];
    const oldest = this.events[0]?.seq ?? this.last + 1;
    if (seq < oldest - 1) return null;
    return this.events.slice(this.events.findIndex((e) => e.seq > seq));
  }
}
