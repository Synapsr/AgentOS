import { useEffect, useState } from "react";
import { stageSize } from "@agentos/design";
import { STATES } from "@agentos/presence";
import { Presence } from "../ui/Presence";
import { useSurface } from "../ui/surface";
import "./PresenceGallery.css";

/** A voice-like level: syllables, with a pause now and then. */
function useFakeVoice(): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => {
      const t = (performance.now() - started) / 1000;
      const speaking = Math.sin(t * 0.9) > -0.5;
      setLevel(speaking ? Math.max(0, 0.55 + 0.45 * Math.sin(t * 7.3) * Math.sin(t * 2.9)) : 0);
    }, 50);
    return () => clearInterval(timer);
  }, []);
  return level;
}

/** `?demo=presence` — the presence in each of its states, side by side. `&light` shows it as ink on a utility surface. */
export function PresenceGallery() {
  useSurface(new URLSearchParams(location.search).has("light") ? "utility" : "presence");
  const level = useFakeVoice();
  return (
    <main className="presence-gallery">
      {STATES.map((state) => (
        <figure key={state}>
          <Presence size={stageSize("onboarding")} state={state} level={level} />
          <figcaption>{state}</figcaption>
        </figure>
      ))}
    </main>
  );
}
