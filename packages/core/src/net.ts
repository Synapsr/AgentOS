/**
 * This computer's addresses: which ones other devices can reach it at, and
 * which connections can be trusted to be private without TLS.
 */
import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/** Where the `tailscale` command may be. The macOS app keeps it inside itself. */
const TAILSCALE_COMMANDS = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

/**
 * Base URLs a client can try, best first: Tailscale (plain HTTP — Tailscale
 * encrypts), then the local network (HTTPS with the computer's own
 * certificate). `host` is the address the core listens on, when it is not
 * all of them: only what can actually be reached there is offered.
 */
export async function addresses(port: number, host?: string | null): Promise<string[]> {
  const everywhere = !host || host === "0.0.0.0" || host === "::";
  if (!everywhere && isLoopback(host)) return [];
  const ips = interfaceAddresses().filter((ip) => isIP(ip) === 4 && (everywhere || ip === host));
  const tailscale = ips.filter(isTailscale);
  const local = ips.filter((ip) => !isTailscale(ip) && !ip.startsWith("169.254."));
  const name = tailscale.length > 0 && everywhere ? await magicDnsName() : null;
  return [...tailscale.map((ip) => `http://${ip}:${port}`), ...(name ? [`http://${name}:${port}`] : []), ...local.map((ip) => `https://${ip}:${port}`)];
}

/** The address of the app for a browser on this computer. */
export function localUrl(port: number): string {
  return `http://localhost:${port}`;
}

/** Every address of this computer's network interfaces, except loopback. */
export function interfaceAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => !address.internal)
    .map((address) => address.address);
}

/** Whether an address is this computer talking to itself. */
export function isLoopback(address: string | undefined | null): boolean {
  const ip = plain(address);
  return ip === "::1" || ip === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(ip);
}

/** Whether an address is one Tailscale hands out: 100.64.0.0/10, or fd7a:115c:a1e0::/48. */
export function isTailscale(address: string | undefined | null): boolean {
  const ip = plain(address);
  const [first = 0, second = 0] = ip.split(".").map(Number);
  return (isIP(ip) === 4 && first === 100 && second >= 64 && second <= 127) || ip.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

/**
 * Whether a connection may be served without TLS: only when nobody else can
 * be listening on its way. That is this computer talking to itself, or a
 * connection that both arrived on one of this computer's own Tailscale
 * addresses and comes from a Tailscale address — an address in that range is
 * not enough by itself, since anyone on the local network can aim at ours.
 */
export function isPrivatePath(local: string | undefined, remote: string | undefined, own: string[] = interfaceAddresses()): boolean {
  if (isLoopback(remote)) return true;
  return isTailscale(local) && isTailscale(remote) && own.includes(plain(local));
}

/** An address without its IPv4-in-IPv6 wrapping or brackets. */
function plain(address: string | undefined | null): string {
  return (address ?? "").replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
}

/** This computer's MagicDNS name, when the `tailscale` command is there to tell us. */
async function magicDnsName(): Promise<string | null> {
  for (const command of TAILSCALE_COMMANDS) {
    const status = await run(command, ["status", "--json"]);
    if (status === null) continue;
    try {
      const name: unknown = JSON.parse(status).Self?.DNSName;
      return typeof name === "string" && name ? name.replace(/\.$/, "") : null;
    } catch {
      return null;
    }
  }
  return null;
}

function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 2000 }, (error, stdout) => resolve(error ? null : stdout));
  });
}
