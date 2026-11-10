import { en } from "./en";
import { fr as frRaw } from "./fr";

/** The shape every language follows: the English page's. */
export type Copy = typeof en;
export type Lang = "en" | "fr";

/**
 * French puts a no-break space before ? ! ; : and inside « », so that a
 * question mark never starts a line on its own.
 */
function frenchSpaces<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/ ([?!;])/g, " $1")
      .replace(/ ([:»])/g, " $1")
      .replace(/« /g, "« ") as T;
  }
  if (Array.isArray(value)) return value.map(frenchSpaces) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, frenchSpaces(v)])) as T;
  }
  return value;
}

export const copy: Record<Lang, Copy> = { en, fr: frenchSpaces(frRaw) };

/** The other language, for the switch and for hreflang. */
export const other = (lang: Lang): Lang => (lang === "en" ? "fr" : "en");

/** The public repository. Not public yet: linked, never counted. */
export const REPO = "https://github.com/Synapsr/AgentOS";

/** Where the Mac app is downloaded: the .dmg of the latest GitHub release. */
export const DOWNLOAD = `${REPO}/releases/latest`;

/**
 * How to start your own relay, exactly as docs/connecting.md gives it. The
 * relay does not start without a token, and its image is not published yet,
 * so it is built from the clone. When an image is published, this becomes
 * one line: change it here, nowhere else.
 */
export const RELAY_COMMAND = [
  "docker build -f packages/relay/Dockerfile -t agentos-relay .",
  "",
  "RELAY_TOKEN=$(openssl rand -hex 32)",
  'echo "$RELAY_TOKEN"     # your computer will need it',
  'docker run -d -p 8080:8080 -v agentos-relay:/data -e RELAY_TOKEN="$RELAY_TOKEN" agentos-relay',
].join("\n");
