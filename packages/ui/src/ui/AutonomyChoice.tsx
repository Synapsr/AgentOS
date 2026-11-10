import { Autonomy } from "@agentos/protocol";
import { useT } from "../client/hooks";
import { Icon, type IconName } from "./Icon";
import "./AutonomyChoice.css";

/** Each level's picture: a raised hand, a shield, a bolt. */
const ICONS: Record<Autonomy, IconName> = { supervised: "hand", balanced: "shield", autonomous: "bolt" };

interface AutonomyChoiceProps {
  value: Autonomy;
  onChange: (value: Autonomy) => void;
  /** Puts the keyboard on the selected level, so arrows and Enter work at once. */
  autoFocus?: boolean;
}

/** "How much should Nova ask?": the three levels as option cards, in human words. */
export function AutonomyChoice({ value, onChange, autoFocus }: AutonomyChoiceProps) {
  const t = useT();
  return (
    <div className="choices" role="radiogroup" aria-label={t("autonomyTitle")}>
      {Autonomy.options.map((level) => (
        <label key={level} className="choice">
          <input
            type="radio"
            name="autonomy"
            checked={value === level}
            onChange={() => onChange(level)}
            autoFocus={autoFocus && value === level}
          />
          <span className="choice-tile">
            <Icon name={ICONS[level]} />
          </span>
          <span className="choice-text">
            <span className="choice-title">
              {t(level)}
              {level === "balanced" && <span className="choice-tag">{t("recommended")}</span>}
            </span>
            <span className="choice-help">{t(`${level}Help`)}</span>
          </span>
          <span className="choice-mark" />
        </label>
      ))}
    </div>
  );
}
