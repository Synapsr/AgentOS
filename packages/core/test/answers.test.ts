import { describe, expect, it } from "vitest";
import { yesOrNo } from "../src/answers.js";

describe("yes or no", () => {
  it.each([
    "yes", "Yes!", "Yes.", "ok", "OK.", "okay", "go ahead", "Go ahead!", "yes go ahead", "Yes, do it.", "do it", "approved",
    "oui", "Oui !", "vas-y", "Vas-y !", "oui vas-y", "Oui, vas-y.", "d'accord", "fais-le", "tu peux",
  ])("%s → yes", (text) => expect(yesOrNo(text)).toBe("yes"));

  it.each([
    "no", "No.", "nope", "stop", "STOP!", "don't", "do not", "no thanks", "cancel",
    "non", "Non merci", "arrête", "Arrête !", "annule", "surtout pas", "ne fais pas ça",
  ])("%s → no", (text) => expect(yesOrNo(text)).toBe("no"));

  // What an independent review got a deletion approved with, when any agreeable word counted.
  it.each(["ok thanks", "Go!", "ok?", "fine", "no problem", "parfait"])("%s → not a yes", (text) => {
    expect(yesOrNo(text)).not.toBe("yes");
  });

  // Anything more than a plain yes or no decides nothing: the owner is asked again.
  it.each([
    "", "hmm", "yes?", "oui ?", "yes but only the build folder", "ok mais seulement le dossier build", "what would that delete?",
    "use the staging server instead", "oui si les tests passent", "sure, do it", "ok vas-y mais doucement", "yes yes yes go",
    "no, wait", "not now", "ok stop", "c'est bon", "pas de souci", "go", "thanks",
  ])("%s → unclear", (text) => expect(yesOrNo(text)).toBeNull());
});
