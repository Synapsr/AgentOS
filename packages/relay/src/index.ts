/**
 * @agentos/relay — reach a computer from anywhere.
 *
 * `startRelay()` runs the relay itself (see cli.ts for the command the
 * container starts). The tunnel exports are for the other end: the core
 * uses them to connect out to a relay.
 */
export { type RelayOptions, type RunningRelay, startRelay } from "./relay.js";
export { FRAME_BYTES, PING_MS, SILENCE_MS, Stream, type StreamEvents, type StreamRequest, type StreamResponse, Tunnel, WINDOW_BYTES } from "./tunnel.js";
