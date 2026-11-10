import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createPresence, type Presence as Renderer, type PresenceState, type PulseKind } from "@agentos/presence";
import { timing } from "./surface";
import "./Presence.css";

export type { PresenceState };

interface PresenceProps {
  /** Side of the stage, in CSS pixels (`stageSize` from the design system). At rest the body fills half of it. */
  size: number;
  state: PresenceState;
  /** How loud the voice is right now, 0–1, for `listening` and `speaking`. */
  level?: number;
  /** The surface it sits on; `auto` (the default) reads the element's `color-scheme`. OS mode and the watch are always dark. */
  theme?: "dark" | "light" | "auto";
  /**
   * Something that really happened, answered with the body: "approved" (a
   * nod), "denied" (the hand lowered), "retry" (offline, one lift). Give a
   * new `id` to send it again.
   */
  pulse?: { kind: PulseKind; id: number | string };
}

/**
 * The agent's presence (docs/PRESENCE.md). The drawing, and the easing of
 * a change of state or size, live in `@agentos/presence`; this only keeps
 * one alive for a component.
 */
export function Presence({ size, state, level = 0, theme = "auto", pulse }: PresenceProps) {
  const stage = useRef<HTMLDivElement>(null);
  const renderer = useRef<Renderer | null>(null);

  // Before the first paint, so that the stage has its size from the start.
  useLayoutEffect(() => {
    if (!stage.current) return;
    const presence = createPresence(stage.current, { size, state, level, theme });
    renderer.current = presence;
    return () => {
      presence.destroy();
      renderer.current = null;
    };
  }, []);

  useLayoutEffect(() => renderer.current?.set({ size, state, level, theme }), [size, state, level, theme]);
  // A pulse is an event, not a state: sent once for each new id.
  useEffect(() => {
    if (pulse) renderer.current?.pulse(pulse.kind);
  }, [pulse?.id]);

  return <div className="presence" ref={stage} aria-hidden />;
}

/**
 * The agent's current line. A new one comes in two beats — the old one out,
 * then the new one in — so that two sentences are never on screen at once.
 * It fades in when it first appears too: a line replaced the instant it
 * arrives (the status catching up after an answer) is then never seen.
 */
export function Line({ text, className }: { text: string; className: string }) {
  return (
    <div className={`line ${className}`} aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.p
          key={text}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: timing("base") }}
          exit={{ opacity: 0, transition: timing("fast", "in") }}
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

interface LabelledPresenceProps extends PresenceProps {
  /** The agent's name, above the stage. */
  name: string;
  /** Above a large stage (a window, OS mode) the name is set larger. */
  large?: boolean;
  /** What goes below the stage: the agent's line, or what takes its place. */
  children: ReactNode;
}

/** The presence with its label: the agent's name above, the stage, its line below. */
export function LabelledPresence({ name, large, children, ...presence }: LabelledPresenceProps) {
  return (
    <div className="labelled-presence" data-large={large || undefined} style={{ "--stage": `${presence.size}px` } as CSSProperties}>
      <p className="presence-name">{name}</p>
      <Presence {...presence} />
      {children}
    </div>
  );
}
