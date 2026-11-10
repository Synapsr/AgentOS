/**
 * Understanding words said or typed in reply to "Can I go ahead?".
 *
 * A reply is a yes or a no only when the whole of it is one of the phrases
 * below: nothing before, nothing after, no question mark. Everything else —
 * "ok thanks", "fine", "go for the first one", a question — decides nothing:
 * the request keeps waiting and the owner is asked again. A wrong yes lets a
 * risky action through, so the lists are short and hold only what means one
 * thing when it is all that was said.
 */

const YES = new Set([
  "yes", "yeah", "ok", "okay", "yes go ahead", "yes do it", "yes please", "yes you can", "go ahead", "do it", "you can",
  "approve", "approved", "i approve",
  "oui", "ouais", "d accord", "oui vas y", "oui fais le", "oui tu peux", "oui s il te plait", "vas y", "allez y", "fais le",
  "tu peux", "j approuve", "approuve",
]);

const NO = new Set([
  "no", "nope", "no stop", "no don t", "no thanks", "stop", "cancel", "don t", "do not", "don t do it", "deny", "denied",
  "non", "non merci", "non stop", "non arrete", "arrete", "annule", "ne fais pas ca", "ne le fais pas", "surtout pas", "refuse",
]);

/** "yes", "no", or null when the reply is anything less plain than that. */
export function yesOrNo(text: string): "yes" | "no" | null {
  // Someone who asks back has not answered.
  if (text.includes("?")) return null;
  const said = normalize(text);
  if (YES.has(said)) return "yes";
  return NO.has(said) ? "no" : null;
}

/** Lower case, no accents, no punctuation: "Vas-y !" → "vas y". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
