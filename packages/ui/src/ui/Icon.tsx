import type { ReactNode } from "react";
import { bridgePaths, dropsPath, glyph, mark, type GlyphState } from "@agentos/presence";

/**
 * The icon set (docs/DESIGN.md, "Icons"): a 24-unit grid, drawn with a
 * round 1.75 stroke in the colour of the text around it. Friendly rather
 * than technical: a hand for Stop, soft corners, open forms.
 */
const ICONS = {
  // `pathLength` lets a check draw itself in when something is confirmed.
  check: <path pathLength={1} d="M5 12.5l4.2 4.2L19 7" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  hand: (
    <path d="M8.5 12.5V6.75a1.5 1.5 0 0 1 3 0V11.5M11.5 11V5.25a1.5 1.5 0 0 1 3 0V11.5M14.5 11.5V6.75a1.5 1.5 0 0 1 3 0v7.75a6 6 0 0 1-6 6h-.6a5.5 5.5 0 0 1-4.3-2.1l-2.7-3.5a1.55 1.55 0 0 1 2.3-2.05L8.5 15V12.5" />
  ),
  alert: (
    <>
      <path d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.1A2 2 0 0 1 19 19.7H5a2 2 0 0 1-1.7-3l7-12.1Z" />
      <path d="M12 9.5v4M12 16.6h.01" />
    </>
  ),
  chevron: <path d="M10 6.5l5.5 5.5-5.5 5.5" />,
  chevronDown: <path d="M6.5 10l5.5 5.5 5.5-5.5" />,
  back: <path d="M14 6.5L8.5 12l5.5 5.5" />,
  send: <path d="M12 19V5.5M6.5 11L12 5.5 17.5 11" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2.5" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  screen: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="2.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  settings: (
    <>
      <path d="M4.5 7.5h9M17.5 7.5h2M4.5 16.5h2M10.5 16.5h9" />
      <circle cx="15.5" cy="7.5" r="2" />
      <circle cx="8.5" cy="16.5" r="2" />
    </>
  ),
  phone: (
    <>
      <rect x="6.5" y="2.75" width="11" height="18.5" rx="3" />
      <path d="M10.5 18h3" />
    </>
  ),
  watch: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="3" />
      <path d="M9 6.5l.6-3h4.8l.6 3M9 17.5l.6 3h4.8l.6-3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="3.75" />
      <path d="M10.7 12.3L19 4M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5Z" />
    </>
  ),
  shield: <path d="M12 3.5l7 2.6v5.4c0 4.4-2.9 7.7-7 9-4.1-1.3-7-4.6-7-9V6.1l7-2.6Z" />,
  bolt: <path d="M13 3.5L5.5 13.5H12l-1 7 7.5-10H12l1-7Z" />,
  zoom: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l4.5 4.5M10.5 8v5M8 10.5h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  person: (
    <>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  voice: <path d="M7 9.5v5M12 6v12M17 9.5v5" />,
  brain: (
    <path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.3A3.2 3.2 0 0 0 8 18.5a2.5 2.5 0 0 0 4 1V5.6a2.6 2.6 0 0 0-3-1.1ZM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.3 3.2 3.2 0 0 1-3.5 5.7 2.5 2.5 0 0 1-4 1" />
  ),
  faceid: (
    <path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 15.5c1.5 1.2 3.5 1.2 5 0" />
  ),
  touchid: (
    <path d="M6 10.5a6 6 0 0 1 12 0v2M9 19.5c-.7-1.6-1-3.4-1-5.5v-3.5a4 4 0 0 1 8 0V14M12 10.5V14c0 2.4.6 4.4 1.6 6M16 17c.2 1 .5 1.9.9 2.6M4.5 15c.3-1.2.5-2.6.5-4" />
  ),
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  bubble: (
    <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h0A2.5 2.5 0 0 1 5 13.5Z" />
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  /** 16 px, for dense rows. */
  dense?: boolean;
  /** 24 px, where it leads a decision. */
  large?: boolean;
  /** The one of two icons in a `.swap` that is not showing. */
  off?: boolean;
}

/** A line icon in the colour of the text around it: 20 px, 16 in dense rows, 24 where it leads a decision. */
export function Icon({ name, dense, large, off }: IconProps) {
  return (
    <svg className={dense ? "icon dense" : large ? "icon large" : "icon"} data-icon={name} data-off={off || undefined} viewBox="0 0 24 24" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

const GLYPH_SIZE = 20;
const GLYPHS = Object.fromEntries(
  (["idle", "working", "waiting", "offline"] as const).map((state) => {
    const frame = glyph(state, GLYPH_SIZE);
    return [state, [dropsPath(frame), ...bridgePaths(frame)]];
  }),
) as Record<GlyphState, string[]>;

/**
 * A still glyph of the presence in `state` (the menu bar's drawing), in its
 * state's colour: beside "Nova is asking", in chips, beside a computer's name.
 */
export function Glyph({ state }: { state: GlyphState }) {
  const half = GLYPH_SIZE / 2;
  return (
    <svg className="glyph" data-glyph={state} viewBox={`${-half} ${-half} ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden>
      {GLYPHS[state].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const MARK = (() => {
  const frame = mark(GLYPH_SIZE);
  return [dropsPath(frame), ...bridgePaths(frame)];
})();

/** The brand mark (three drops mid-juggle), in the idle pearl or ink: where the agent itself is meant, as in "Your agent's name". */
export function Mark() {
  const half = GLYPH_SIZE / 2;
  return (
    <svg className="glyph" data-glyph="idle" viewBox={`${-half} ${-half} ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden>
      {MARK.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
