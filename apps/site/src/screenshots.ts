/**
 * The product recording and screenshots the site shows, read straight from
 * docs/screenshots at build time (Astro resizes and compresses the images;
 * the video is copied as is and only loads when played). When those files
 * are refreshed, the site follows on its next build; to show different
 * ones, change this file. The iPhone and watch screenshots
 * (docs/screenshots/ios, docs/screenshots/watch) have the new look too.
 */
import type { ImageMetadata } from "astro";
import osModeVideo from "../../../docs/screenshots/os-mode.mp4?url";
import osWorking from "../../../docs/screenshots/os-working.png";
import panel from "../../../docs/screenshots/panel.png";
import phoneWaiting from "../../../docs/screenshots/phone-waiting.png";

type Words = { en: string; fr: string };

/** OS mode, recorded: 1280 × 720, silent, about 15 seconds. */
export const recording = {
  video: osModeVideo,
  /** Shown until it is played: a still of the same screen. */
  poster: osWorking,
  width: 1280,
  height: 720,
};

export interface Screenshot {
  image: ImageMetadata;
  alt: Words;
}

/** Tall screens, shown beside the recording. */
export const gallery: Screenshot[] = [
  {
    image: panel,
    alt: {
      en: "The side panel: Nova running the tests, above the conversation.",
      fr: "Le panneau latéral : Nova lance les tests, au-dessus de la conversation.",
    },
  },
  {
    image: phoneWaiting,
    alt: {
      en: "The web client on a phone, with Nova’s question and its two buttons.",
      fr: "Le client web sur un téléphone, avec la question de Nova et ses deux boutons.",
    },
  },
];
