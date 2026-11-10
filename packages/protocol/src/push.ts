/**
 * AgentOS wire protocol — push notifications.
 *
 * When the agent needs its owner, or has finished, and no app is in front,
 * the computer sends a notification through the platform's push service
 * (APNs today). The standard part of the payload (`aps`) is what the system
 * shows; the custom part described here, under the key `agentos`, tells the
 * app what the notification is about.
 *
 *   {
 *     "aps": {
 *       "alert": { "title": "<agent name>", "body": "<sentence to read>" },
 *       "sound": "default",
 *       "category": "AGENTOS_APPROVAL",
 *       "thread-id": "<threadId>",
 *       "interruption-level": "time-sensitive",   // requests only
 *       "mutable-content": 1                       // requests only: the app dresses them
 *     },
 *     "agentos": { …PushPayload }
 *   }
 *
 * A request is one notification: its id is the notification's identifier
 * (`apns-collapse-id`), so a newer push for the same request replaces the
 * older one, and the app can remove it when told it was resolved elsewhere.
 *
 * A finished turn's identifier is `turn.<nodeId>.<threadId>`, also used as
 * its `thread-id`. An app that is alive in the background and posts its own
 * notification for the turn uses the same identifier, so that the two are
 * one notification.
 */
import { z } from "zod";
import { Risk } from "./schemas.js";

/** Key of the custom part in the notification payload. */
export const PUSH_PAYLOAD_KEY = "agentos";

/** Version of the custom part. An app ignores a notification of a version it does not know. */
export const PUSH_VERSION = 1;

/**
 * Notification categories (`aps.category`). The app registers its actions
 * for each:
 * - `approval`: two buttons, "Go ahead" and "Stop", answering
 *   `POST /v1/requests/:id/resolve` with `optionId` `approve` / `deny`.
 * - `question`: a text reply, answering the same route with `text`
 *   (the request's own options are at `GET /v1/requests`).
 * - `turn`: nothing to answer; a reply, if offered, is a new message.
 */
export const PushCategory = {
  approval: "AGENTOS_APPROVAL",
  question: "AGENTOS_QUESTION",
  turn: "AGENTOS_TURN",
} as const;
export type PushCategory = (typeof PushCategory)[keyof typeof PushCategory];

/** The custom part of a notification: the value of `agentos` in its payload. */
export const PushPayload = z.object({
  /** `PUSH_VERSION`. */
  version: z.number().int(),
  /** The computer that sent it: which of the app's pairings this is about. */
  nodeId: z.string(),
  /**
   * - `request`:  the agent needs its owner. A time-sensitive alert.
   * - `turn`:     the agent finished and has something to say. An alert.
   * - `resolved`: a request was answered or cancelled elsewhere. Silent:
   *               remove the notification whose identifier is `requestId`.
   */
  kind: z.enum(["request", "turn", "resolved"]),
  threadId: z.string(),
  /** The request, for `request` and `resolved`; null for `turn`. */
  requestId: z.string().nullable(),
  /** `FileRef.id` of what the agent sees, when the request has it: fetch `GET /v1/files/:id` to show it. */
  screenshotId: z.string().nullable(),
  /**
   * The request's risk, when there is a request; null for `turn`. Lets the
   * lock screen say "worth a careful look" before the app is opened.
   */
  risk: Risk.nullable(),
});
export type PushPayload = z.infer<typeof PushPayload>;
