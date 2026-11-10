# Voice

You can talk to your agent and it can talk back. The agent is always the
brain; voice only converts speech to text and text to speech. Who does the
converting is one setting, with three positions.

| Setting | Who hears and speaks | You need | Audio goes to |
|---|---|---|---|
| `device` (default) | Your phone | Nothing | Nowhere: it stays on the phone |
| `elevenlabs` | Your computer, with [ElevenLabs](https://elevenlabs.io) | One key | ElevenLabs |
| `local` | Your computer, with a speech server you run | Its address | Your own server |

Voice lives in the iPhone app. The web client is typed.

## Your phone's own voice

The default, with nothing to set up. The iPhone recognises what you say and
reads the agent's answers itself, with the speech built into iOS. No audio
leaves the phone; your computer only ever receives text.

## A premium voice: ElevenLabs

Choose **ElevenLabs** in Settings → Voice and paste a key, or start the core
with both:

```sh
AGENTOS_VOICE=elevenlabs ELEVENLABS_API_KEY=… pnpm start
```

The phone then records what you say and sends the audio to your computer,
which asks ElevenLabs for the text; in the other direction your computer
asks for the speech and streams it to the phone. **The key stays on your
computer**: the phone never has it, and the API never returns it.

The voice is ElevenLabs' suggested default. To use another one, set
`voice.voice` in `~/.agentos/config.json` to its id.

*Tested with a real key by the people who built it. Not run again for this
guide.*

## Your own speech server

For a premium voice with no cloud at all. Any server that speaks the OpenAI
audio API will do (`POST /v1/audio/transcriptions` and
`POST /v1/audio/speech`), for example
[mlx-audio](https://github.com/Neywa-Labs/mlx-audio) running open models on the
same Mac. Choose **Your own speech server** in Settings → Voice and give its
address, or:

```sh
AGENTOS_VOICE=local AGENTOS_VOICE_URL=http://127.0.0.1:8000 pnpm start
```

By default AgentOS asks for the models `whisper-1` and `tts-1`, the names
such servers conventionally answer to. A server that wants real model ids
(mlx-audio does) gets them from `voice.sttModel` and `voice.ttsModel` in
`~/.agentos/config.json`; `voice.voice` names the voice.

*Written from the code. Not run for this guide.*

## Talking

- **Tap to talk.** On the phone's home screen, tap **Tap to talk**, speak,
  and tap again to send. Holding it down while you speak works too.
- **Answering a request out loud.** Every request carries a sentence written
  to be spoken, and can be answered by voice. What you say right after the
  agent asks is sent as your reply to that question, and to nothing else.
  For an approval, a reply counts only when it is plainly one thing: "yes",
  "go ahead", "do it", "allez-y", "vas-y", "d'accord" approve; "no", "stop", "cancel",
  "non", "arrête" refuse. Anything else decides nothing: "yes, but only the
  build folder", "fine", a question. The request keeps waiting, and you are
  asked again.
- **Earbuds.** Tap **Earbuds** (the headphones, top right) with earbuds in
  and put the phone in your pocket. When the agent finishes or needs you, the phone says it over your
  music, listens a few seconds for your answer and sends it. It pauses by
  itself when the earbuds come out or a call takes the audio; notifications
  carry on meanwhile.

*Voice was exercised in the iPhone simulator. On-device speech and the
Earbuds mode have not yet been verified on a real iPhone with earbuds: see
[Status](../README.md#status).*

## Adding a provider

A provider is one small file in [`packages/voice/src`](../packages/voice/src):
an id, a label, whether it needs a key or an address, and two functions,
`transcribe` and `speak`. Look at `elevenlabs.ts`, add yours to the list in
`index.ts`, and the Settings page offers it. Its key is read from
`<PROVIDER>_API_KEY` or from Settings.
