/** Thrown when speech is asked of the `device` provider: the phone does it, not the computer. */
export class VoiceUnavailable extends Error {
  constructor(message = "This voice provider runs on the device, not on the computer.") {
    super(message);
    this.name = "VoiceUnavailable";
  }
}

/**
 * Why a provider failed. The code is stable, so the core can translate it.
 *
 * - `bad_key`      the provider refused the API key.
 * - `quota`        the account is out of credits, or its plan does not cover the request.
 * - `rate_limited` too many requests right now; trying again later will work.
 * - `unreachable`  nothing answered (server not running, no network).
 * - `rejected`     the provider refused this request (unknown voice or model, unreadable audio).
 * - `failed`       the provider itself broke.
 */
export type VoiceErrorCode = "bad_key" | "quota" | "rate_limited" | "unreachable" | "rejected" | "failed";

/** A provider failure, with a short message a person can read. */
export class VoiceError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    message: string,
    /** HTTP status the provider answered with, when it answered. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}
