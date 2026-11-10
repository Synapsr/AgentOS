/**
 * Notifications to the owner's phone and watch, for when no app is in front:
 * the agent needs them, or has finished. Opt-in: it takes the signing key of
 * whoever built the app (see `Home.apns`); without one, nothing here runs.
 *
 * What is sent is described once, for the app and for us, in
 * `@agentos/protocol` (push.ts).
 */
import { type Event, MAIN_THREAD, PUSH_PAYLOAD_KEY, PUSH_VERSION, PushCategory, type PushPayload, type RequestItem } from "@agentos/protocol";
import type { Core } from "../core.js";
import { shorten } from "../text.js";
import { Apns, type Notification } from "./apns.js";

/** Longest text put in a notification: Apple takes 4 KB in all, and a lock screen shows far less. */
const BODY_CHARS = 600;

/**
 * Starts notifying. `watched` says whether the owner is looking at a client
 * right now. Returns the way to stop.
 */
export function startPush(core: Core, watched: () => boolean): () => void {
  const settings = core.home.apns;
  if (!settings) return () => {};
  let apns: Apns;
  try {
    apns = new Apns(settings, core.apnsHosts);
  } catch {
    core.log("The APNs key could not be read: notifications are off");
    return () => {};
  }

  const about = (kind: PushPayload["kind"], threadId: string, request: RequestItem | null): PushPayload => ({
    version: PUSH_VERSION,
    nodeId: core.home.nodeId,
    kind,
    threadId,
    requestId: request?.id ?? null,
    screenshotId: request?.screenshot?.id ?? null,
    risk: request?.risk ?? null,
  });

  /** Sends to every device registered with Apple, except `but`; forgets the ones Apple no longer knows. */
  const notify = (notification: Notification, but: string | null = null): void => {
    for (const target of core.store.devices.pushTargets("apns")) {
      if (target.deviceId === but) continue;
      void apns.send(target.token, target.sandbox, notification).then((delivery) => {
        if (delivery !== "gone") return;
        core.store.devices.setPush(target.deviceId, { kind: "none", token: null, sandbox: false });
        core.log(`Notifications turned off for a device Apple no longer knows (${target.deviceId})`);
      });
    }
  };

  /** `group`: what the system stacks the notification with (`thread-id`). */
  const alert = (body: string, category: PushCategory, group: string, extra: object = {}): object => ({
    alert: { title: core.home.config.agentName, body: shorten(body, BODY_CHARS) },
    sound: "default",
    category,
    "thread-id": group,
    ...extra,
  });

  const unsubscribe = core.node.subscribe((event: Event) => {
    if (event.type === "item.added" && event.item.type === "request") {
      const request = event.item;
      const category = request.kind === "approval" ? PushCategory.approval : PushCategory.question;
      // The agent is waiting: this may break through a Focus. Always mutable, so the app's extension can
      // dress it (risk line, high-risk actions) and fetch the picture when there is one.
      const urgent = { "interruption-level": "time-sensitive", "mutable-content": 1 };
      notify({
        type: "alert",
        // One request, one notification, whatever is sent about it later.
        collapseId: request.id,
        payload: { aps: alert(request.spoken, category, request.threadId, urgent), [PUSH_PAYLOAD_KEY]: about("request", request.threadId, request) },
      });
    }
    if (event.type === "item.updated" && event.item.type === "request" && event.item.state !== "pending") {
      const request = event.item;
      // Answered or cancelled: the other devices quietly take their notification down.
      const payload = { aps: { "content-available": 1 }, [PUSH_PAYLOAD_KEY]: about("resolved", request.threadId, request) };
      notify({ type: "background", payload }, request.resolution?.deviceId ?? null);
    }
    // The main conversation only: a job reports there, and the agent then says so itself.
    if (event.type === "turn.completed" && event.threadId === MAIN_THREAD && event.text.trim() && !watched()) {
      // An app alive in the background posts its own notification under this same id: the two are then one.
      const id = `turn.${core.home.nodeId}.${event.threadId}`;
      const payload = { aps: alert(event.text, PushCategory.turn, id), [PUSH_PAYLOAD_KEY]: about("turn", event.threadId, null) };
      notify({ type: "alert", collapseId: id, payload });
    }
  });

  return () => {
    unsubscribe();
    apns.close();
  };
}
