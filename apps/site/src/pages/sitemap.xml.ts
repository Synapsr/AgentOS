/** The sitemap: both pages in both languages, each pointing at its other language. */
import type { APIRoute } from "astro";
import { copy, type Copy } from "../i18n";

export const GET: APIRoute = ({ site }) => {
  const url = (path: string) => new URL(path, site).href;
  const pages = [(t: Copy) => t.path, (t: Copy) => t.devPath];
  const urls = pages
    .flatMap((page) => {
      const alternates = Object.values(copy)
        .map((t) => `<xhtml:link rel="alternate" hreflang="${t.lang}" href="${url(page(t))}"/>`)
        .concat(`<xhtml:link rel="alternate" hreflang="x-default" href="${url(page(copy.en))}"/>`)
        .join("");
      return Object.values(copy).map((t) => `<url><loc>${url(page(t))}</loc>${alternates}</url>`);
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
