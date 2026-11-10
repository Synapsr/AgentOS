import { join } from "node:path";
import type { Item, Thread } from "@agentos/protocol";
import { appendLine, loadLines, readJson, writeJson } from "./disk.js";

/** A thread as stored: what clients see, plus what only the engine needs. */
interface ThreadRecord {
  thread: Thread;
  /** Opaque token the engine uses to pick the conversation up again. */
  resume: string | null;
}

/**
 * Conversations on disk: `threads.json` is the index, `threads/<id>.jsonl`
 * the timeline of one thread. Timelines are append-only — a changed item is
 * appended again and the last version wins when the file is read.
 */
export class ThreadStore {
  private readonly records = new Map<string, ThreadRecord>();
  private readonly timelines = new Map<string, Item[]>();

  constructor(private readonly dir: string) {
    for (const record of readJson<ThreadRecord[]>(this.indexPath) ?? []) {
      this.records.set(record.thread.id, record);
    }
  }

  /** Every thread, oldest first. */
  list(): Thread[] {
    return [...this.records.values()].map((r) => r.thread);
  }

  get(id: string): Thread | null {
    return this.records.get(id)?.thread ?? null;
  }

  /** Creates or replaces a thread. */
  save(thread: Thread): void {
    const record = this.records.get(thread.id);
    this.records.set(thread.id, { thread, resume: record?.resume ?? null });
    this.saveIndex();
  }

  resume(id: string): string | null {
    return this.records.get(id)?.resume ?? null;
  }

  setResume(id: string, resume: string): void {
    const record = this.records.get(id);
    if (!record || record.resume === resume) return;
    record.resume = resume;
    this.saveIndex();
  }

  /** The timeline of a thread, oldest first. Empty for a thread that does not exist. */
  items(threadId: string): Item[] {
    let items = this.timelines.get(threadId);
    if (!items) {
      // Only ids we created ever become file names.
      if (!this.records.has(threadId)) return [];
      const latest = new Map<string, Item>();
      for (const item of loadLines<Item>(this.timelinePath(threadId))) latest.set(item.id, item);
      items = [...latest.values()];
      this.timelines.set(threadId, items);
    }
    return items;
  }

  /** Adds an item, or replaces the one with the same id. */
  put(item: Item): void {
    const items = this.items(item.threadId);
    const index = items.findLastIndex((i) => i.id === item.id);
    if (index === -1) items.push(item);
    else items[index] = item;
    appendLine(this.timelinePath(item.threadId), item);
  }

  private get indexPath(): string {
    return join(this.dir, "threads.json");
  }

  private timelinePath(threadId: string): string {
    return join(this.dir, "threads", `${threadId}.jsonl`);
  }

  private saveIndex(): void {
    writeJson(this.indexPath, [...this.records.values()]);
  }
}
