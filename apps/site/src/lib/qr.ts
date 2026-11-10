import QRCode from "qrcode";

/**
 * A QR code as SVG, drawn like the one the desktop app shows when you add
 * your phone: round dots, rounded finder squares. Made at build time.
 */
export function qrSvg(text: string, label: string): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const dark = (x: number, y: number) => modules.get(y, x) === 1;
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

  const dots: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // A zero-length line with round caps is a dot: the smallest way to write one.
      if (dark(x, y) && !finder(x, y)) dots.push(`M${x + 0.5} ${y + 0.5}h0`);
    }
  }
  const eye = (x: number, y: number) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.9" fill="none" stroke="currentColor"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9"/>`;

  return (
    `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" role="img" aria-label="${label.replace(/"/g, "&quot;")}" fill="currentColor">` +
    `<path d="${dots.join("")}" stroke="currentColor" stroke-width=".84" stroke-linecap="round"/>` +
    `${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</svg>`
  );
}
