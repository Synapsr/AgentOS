import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAppState, useStore, useT } from "../client/hooks";
import { Icon } from "./Icon";
import "./Conversation.css";

/**
 * The one input: say something to the agent, or stop it while it works.
 * While a question accepts an answer in words, what is written here is
 * that answer, and the placeholder says so.
 */
export function Composer({ threadId, compact = false }: { threadId: string; compact?: boolean }) {
  const store = useStore();
  const t = useT();
  const working = useAppState((state) => state.threads.find((thread) => thread.id === threadId)?.state === "working");
  const asking = useAppState((state) => state.requests.length > 0);
  const question = useAppState((state) => state.requests.find((request) => request.allowText));
  const online = useAppState((state) => state.online);
  const [text, setText] = useState("");
  /** What did not leave: the words of a message, or the order to stop. */
  const [failed, setFailed] = useState<"message" | "stop" | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const stops = working && !text.trim() && !question;
  // Offline, it says so where one would start typing: nothing typed now would be heard.
  const placeholder = !online ? t("talkOffline") : question ? t("answerInWords") : t("talkTo");

  // Grow with what is typed, up to the CSS max-height.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Typing with nothing selected is talking to the agent: no need to click
  // the field first. Not while it is asking, though: the keys must never
  // land here by themselves when a question is on screen.
  useEffect(() => {
    if (asking) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typed = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (typed && document.activeElement === document.body) area.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);

  const act = async () => {
    const words = text.trim();
    if (!online) return setFailed(stops ? "stop" : "message");
    setFailed(null);
    try {
      if (stops) return await store.client.interrupt(threadId);
      setText("");
      if (question) await store.resolve(question.id, null, words);
      else await store.send(threadId, words);
    } catch {
      setFailed(stops ? "stop" : "message");
      // Give the words back rather than lose them.
      if (!stops) setText((current) => current || words);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (text.trim()) void act();
  };

  const look = stops ? "stop" : text.trim() ? "send" : "empty";
  return (
    <div className="composer">
      {/* The whole capsule is the place to press, not only the line of text inside it. */}
      <div
        className="composer-box"
        data-compact={compact || undefined}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          area.current?.focus();
        }}
      >
        <textarea
          ref={area}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          enterKeyHint="send"
        />
        <button className="composer-action" data-look={look} disabled={look === "empty"} aria-label={stops ? t("stopAgent") : t("send")} onClick={() => void act()}>
          <span className="swap">
            <Icon name="send" off={stops} />
            <Icon name="stop" off={!stops} />
          </span>
        </button>
      </div>
      {failed && (
        <p className="composer-failed field-error" role="status">
          {failed === "stop" ? t("failed") : `${t("notSent")} · `}
          {failed === "message" && (
            <button className="link composer-retry" onClick={() => void act()}>
              {t("tryAgain")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
