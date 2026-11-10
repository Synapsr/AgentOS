/** Stand-ins for what the agent would see on a real screen, drawn as SVG. */

export type Shot = "bank" | "site";

const FONT = `font-family="-apple-system, system-ui, sans-serif"`;

/** A desktop with one window on it; `content` is drawn inside the window (1040 × 640, from 120,80). */
function desktop(title: string, content: string): string {
  // A definite size (as a real capture has), so that "Look closer" can show it large.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" width="2560" height="1600">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#27304f"/><stop offset=".55" stop-color="#43386b"/><stop offset="1" stop-color="#7a4a6a"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="800" fill="url(#wall)"/>
  <rect x="124" y="88" width="1040" height="640" rx="14" fill="#000" opacity=".25"/>
  <rect x="120" y="80" width="1040" height="640" rx="14" fill="#fbfbfd"/>
  <path d="M120 94a14 14 0 0 1 14-14h1012a14 14 0 0 1 14 14v34H120z" fill="#ececf0"/>
  <circle cx="146" cy="104" r="7" fill="#ff5f57"/><circle cx="170" cy="104" r="7" fill="#febc2e"/><circle cx="194" cy="104" r="7" fill="#28c840"/>
  <text x="640" y="110" text-anchor="middle" ${FONT} font-size="15" fill="#6e6e73">${title}</text>
  ${content}
</svg>`;
}

function bank(french: boolean): string {
  const say = (en: string, fr: string) => (french ? fr : en);
  const row = (y: number, label: string, value: string) => `
  <text x="400" y="${y}" ${FONT} font-size="16" fill="#86868b">${label}</text>
  <text x="880" y="${y}" text-anchor="end" ${FONT} font-size="17" fill="#1d1d1f">${value}</text>
  <rect x="400" y="${y + 18}" width="480" height="1" fill="#e5e5ea"/>`;
  return desktop(
    say("Banque Rivage — New transfer", "Banque Rivage — Nouveau virement"),
    `<rect x="120" y="128" width="200" height="592" fill="#f2f2f5"/>
  ${[176, 216, 256, 296].map((y, i) => `<rect x="148" y="${y}" width="${[120, 96, 132, 84][i]}" height="12" rx="6" fill="${i === 1 ? "#1d1d1f" : "#c7c7cc"}"/>`).join("")}
  <text x="400" y="218" ${FONT} font-size="17" fill="#86868b">${say("Amount", "Montant")}</text>
  <text x="400" y="288" ${FONT} font-size="64" font-weight="300" fill="#1d1d1f">${say("€240.00", "240,00 €")}</text>
  ${row(360, say("To", "Bénéficiaire"), "Durand Plomberie")}
  ${row(418, "IBAN", "FR76 3000 4028 •••• 7731")}
  ${row(476, say("Reference", "Référence"), say("Invoice 2231", "Facture 2231"))}
  ${row(534, say("From", "Depuis"), say("Current account", "Compte courant"))}
  <rect x="640" y="604" width="240" height="56" rx="14" fill="#0a84ff"/>
  <rect x="632" y="596" width="256" height="72" rx="20" fill="none" stroke="#0a84ff" stroke-opacity=".35" stroke-width="4"/>
  <text x="760" y="639" text-anchor="middle" ${FONT} font-size="18" font-weight="600" fill="#fff">${say("Confirm transfer", "Confirmer le virement")}</text>
  <rect x="400" y="604" width="216" height="56" rx="14" fill="#e9e9ee"/>
  <text x="508" y="639" text-anchor="middle" ${FONT} font-size="18" fill="#1d1d1f">${say("Cancel", "Annuler")}</text>`,
  );
}

function site(french: boolean): string {
  const say = (en: string, fr: string) => (french ? fr : en);
  const plan = (x: number, name: string, price: string, featured: boolean) => `
  <rect x="${x}" y="356" width="280" height="300" rx="18" fill="${featured ? "#1d1d1f" : "#f2f2f5"}"/>
  <text x="${x + 28}" y="404" ${FONT} font-size="17" fill="${featured ? "#a1a1a6" : "#6e6e73"}">${name}</text>
  <text x="${x + 28}" y="466" ${FONT} font-size="46" font-weight="300" fill="${featured ? "#fff" : "#1d1d1f"}">${price}</text>
  ${[506, 536, 566].map((y, i) => `<rect x="${x + 28}" y="${y}" width="${[180, 140, 164][i]}" height="10" rx="5" fill="${featured ? "#48484a" : "#d1d1d6"}"/>`).join("")}
  <rect x="${x + 28}" y="600" width="224" height="36" rx="10" fill="${featured ? "#fff" : "#1d1d1f"}"/>`;
  return desktop(
    "atelier-lumen.com — Preview",
    `<text x="640" y="232" text-anchor="middle" ${FONT} font-size="46" font-weight="300" fill="#1d1d1f">${say("Light, made by hand.", "La lumière, faite main.")}</text>
  <text x="640" y="276" text-anchor="middle" ${FONT} font-size="18" fill="#86868b">${say("New prices from Friday", "Nouveaux prix dès vendredi")}</text>
  ${plan(200, say("Small", "Petite"), say("€89", "89 €"), false)}
  ${plan(500, say("Medium", "Moyenne"), say("€149", "149 €"), true)}
  ${plan(800, say("Large", "Grande"), say("€229", "229 €"), false)}`,
  );
}

/** An address showing the given stand-in screenshot: a `blob:`, like a real one fetched from the computer. */
export function screenshot(shot: Shot, french: boolean): string {
  return URL.createObjectURL(new Blob([shot === "bank" ? bank(french) : site(french)], { type: "image/svg+xml" }));
}
