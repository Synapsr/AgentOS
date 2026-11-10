import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { Device, PairingCode } from "@agentos/protocol";
import { useAppState, useStore, useT } from "../client/hooks";
import { browserAddress, webPairingLink } from "../client/token";
import { Icon } from "./Icon";
import "./AddPhone.css";

/** Ask for a new code this long before the current one expires. */
const RENEW_BEFORE = 20_000;
const WATCH_EVERY = 2000;

/**
 * A QR code drawn with square modules, which any camera reads, even an old
 * one in a shaky hand; only the three corner marks are rounded.
 */
function Qr({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
    const inCorner = (row: number, col: number) => (row < 7 || row >= modules.size - 7) && (col < 7 || col >= modules.size - 7) && !(row >= modules.size - 7 && col >= modules.size - 7);
    let dots = "";
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col) && !inCorner(row, col)) dots += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size: modules.size, path: dots };
  }, [text]);
  const corner = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.8} fill="none" stroke="currentColor" strokeWidth={1} />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} />
    </g>
  );
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} fill="currentColor" aria-hidden>
      <path d={path} />
      {corner(0, 0)}
      {corner(size - 7, 0)}
      {corner(0, size - 7)}
    </svg>
  );
}

/**
 * Shows a pairing code to scan, kept fresh, and watches the list of
 * devices: when a new one shows up, the code folds into a check.
 */
export function AddPhone({ onAdded }: { onAdded?: (device: Device) => void }) {
  const { client } = useStore();
  const t = useT();
  const network = useAppState((state) => state.settings?.network);
  const address = network ? browserAddress(network) : null;
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [added, setAdded] = useState<Device | null>(null);
  /** The owner has no app on their phone: show what a browser can do instead. */
  const [noApp, setNoApp] = useState(false);
  const announce = useRef(onAdded);
  announce.current = onAdded;

  useEffect(() => {
    if (added) return;
    let live = true;
    let renew = 0;
    const refresh = async () => {
      const code = await client.createPairingCode().catch(() => null);
      if (!live) return;
      if (code) setPairing(code);
      renew = window.setTimeout(refresh, code ? Math.max(5000, code.expiresAt - Date.now() - RENEW_BEFORE) : 3000);
    };
    void refresh();

    // The phone pairs on its own: whoever was not in the list before is the one.
    let known: Set<string> | null = null;
    const watch = window.setInterval(async () => {
      const devices = await client.devices().catch(() => null);
      if (!live || !devices) return;
      const arrived = known && devices.find((device) => !known?.has(device.id));
      known ??= new Set(devices.map((device) => device.id));
      if (arrived) {
        setAdded(arrived);
        announce.current?.(arrived);
      }
    }, WATCH_EVERY);

    return () => {
      live = false;
      clearTimeout(renew);
      clearInterval(watch);
    };
  }, [client, added]);

  // Without the app, the code becomes one that opens this interface in the
  // phone's browser — if there is an address a browser can open (see
  // `browserAddress`). Otherwise the code stays the app's, and a sentence
  // says what the web version needs.
  const web = noApp && address !== null;
  const link = pairing && (web ? webPairingLink(address, pairing.code) : pairing.link);
  return (
    <div className="add-phone" data-added={added ? true : undefined}>
      <div className="qr-tile" data-appearance="light" data-added={added ? true : undefined}>
        {link && <Qr text={link} />}
        <span className="qr-added">
          <Icon name="check" large />
        </span>
      </div>
      <p className="add-phone-note" aria-live="polite">
        {added ? (
          t("phoneAdded", { device: added.name })
        ) : noApp ? (
          t(web ? "phoneWeb" : "phoneWebNeeds")
        ) : (
          <button type="button" className="link" onClick={() => setNoApp(true)}>
            {t("phoneNoApp")}
          </button>
        )}
      </p>
    </div>
  );
}
