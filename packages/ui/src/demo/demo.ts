/**
 * Demo mode: a computer that exists only in this page.
 *
 * `?demo` runs the whole interface against this in-memory `Client`: no
 * core, no token, scripted but believable. It is how the interface is
 * developed and how screenshots are made.
 *
 *   ?demo            a quiet conversation; say anything to see the agent work
 *   ?demo=working    the agent is in the middle of something
 *   ?demo=waiting    the agent needs its owner
 *   ?demo=question   the agent asks a question of its own (a picture, an answer in words)
 *   ?demo=approval   the agent asks before a step, with the command under Details
 *   ?demo=job        a background job asks, while the conversation is quiet
 *   ?demo=offline    the computer stops answering
 *   ?demo=onboarding the first run
 *   ?demo=presence   the presence in each of its states
 *   &remote          as seen from a phone (no Settings, no local entries)
 *   &account         no key needed: Claude is already set up on the computer
 *   &lang=fr         in French (otherwise the browser’s language)
 *   &appearance=light|dark  instead of the system’s appearance
 */
import {
  APPROVE,
  DENY,
  encodePairingLink,
  MAIN_THREAD,
  type ActivityItem,
  type Device,
  type Event,
  type FileRef,
  type Item,
  type MessageItem,
  type NodeInfo,
  type NodeStatus,
  type RequestItem,
  type RequestResolution,
  type ServerFrame,
  type Settings,
  type Thread,
} from "@agentos/protocol";
import { ApiFailure, type Client } from "../client/client";
import { screenshot, type Shot } from "./screenshots";

export type Scenario = "idle" | "working" | "waiting" | "question" | "approval" | "job" | "offline" | "onboarding";

type Unstamped<E> = E extends Event ? Omit<E, "seq" | "at"> : never;
type Question = Pick<RequestItem, "kind" | "title" | "body" | "spoken" | "risk" | "options" | "allowText"> & { shot: Shot | null };

const MINUTE = 60_000;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)));
  });

/** A `Client` backed by a scripted, in-memory computer. */
export function createDemoClient(scenario: Scenario, options: { remote: boolean; account: boolean; language: string }): Client {
  const french = options.language.toLowerCase().startsWith("fr");
  const say = (en: string, fr: string) => (french ? fr : en);
  const started = Date.now();
  const fresh = scenario === "onboarding";

  let seq = 100;
  let count = 0;
  const id = (prefix: string) => `${prefix}_demo${++count}`;
  let emit: (frame: ServerFrame) => void = () => {};
  let begun = false;

  // ───────────── The computer ─────────────

  let node: NodeInfo = {
    id: "node_demo",
    name: say("Studio Mac", "Mac du bureau"),
    platform: "macos",
    version: "0.1.0",
    protocol: 1,
    agent: { name: "Nova" },
    owner: { name: fresh ? "" : "Alex" },
    language: french ? "fr" : "en",
    autonomy: "balanced",
    onboarded: !fresh,
    capabilities: {
      computer: true,
      engine: "claude",
      engineReady: options.account || !fresh,
      voice: { provider: "device", stt: "device", tts: "device", ttsMime: null },
    },
  };
  let status: NodeStatus = { state: "idle", activity: null, mode: "desktop", pendingRequests: 0, workingThreads: 0 };
  let settings: Settings = {
    engine: {
      provider: "claude",
      model: null,
      auth: options.account ? "environment" : fresh ? "none" : "api-key",
      hasWorkspaceId: false,
      ready: options.account || !fresh,
    },
    voice: {
      provider: "device",
      voice: null,
      hasKey: false,
      url: null,
      available: [
        { id: "device", label: say("Your phone’s own voice", "La voix de votre téléphone"), needsKey: false, needsUrl: false },
        { id: "elevenlabs", label: "ElevenLabs", needsKey: true, needsUrl: false },
        { id: "local", label: say("Your own speech server", "Votre propre serveur vocal"), needsKey: false, needsUrl: true },
      ],
    },
    computer: { permissions: { accessibility: !fresh, screenRecording: !fresh } },
    network: {
      port: 4747,
      // Tailscale stays plain inside its tunnel; the local network is TLS with the computer’s own certificate.
      // A computer that was just set up has no Tailscale yet.
      urls: fresh ? ["https://192.168.1.24:4747"] : ["http://100.92.14.7:4747", "https://192.168.1.24:4747"],
      relayUrl: null,
      relayConnected: false,
      relayError: null,
      hasRelayToken: false,
    },
  };
  let devices: Device[] = fresh
    ? []
    : [
        { id: "dev_phone", name: say("Alex’s iPhone", "iPhone d’Alex"), platform: "ios", createdAt: started - 9 * 24 * 60 * MINUTE, lastSeenAt: started - 3 * MINUTE },
        { id: "dev_watch", name: "Apple Watch", platform: "watchos", createdAt: started - 9 * 24 * 60 * MINUTE, lastSeenAt: started - 50 * MINUTE },
        { id: "dev_web", name: "iPad (Safari)", platform: "web", createdAt: started - 2 * 24 * 60 * MINUTE, lastSeenAt: started - 26 * 60 * MINUTE },
      ];
  let phoneOnItsWay = false;
  /** What the agent is doing in each conversation that works. */
  const doing = new Map<string, string>();

  const threads = new Map<string, Thread>();
  const items = new Map<string, Item[]>();
  const runs = new Map<string, AbortController>();
  const answers = new Map<string, (resolution: RequestResolution) => void>();
  /** Addresses of the stand-in screenshots made so far, by file id. */
  const shots = new Map<string, string>();

  // ───────────── Events ─────────────

  const push = (event: Unstamped<Event>, ephemeral = false) =>
    emit({ type: "event", event: { ...event, seq: ephemeral ? 0 : ++seq, at: Date.now() } as Event });

  /**
   * Recomputes the status. Its activity is what the main conversation is
   * doing, or else what a job that still works is doing: never the label of
   * work that is over.
   */
  function refreshStatus() {
    const all = [...threads.values()];
    const pendingRequests = [...items.values()].flat().filter((item) => item.type === "request" && item.state === "pending").length;
    const working = all.filter((thread) => thread.state === "working");
    const state = pendingRequests ? "waiting" : working.length ? "working" : "idle";
    const current = working.find((thread) => thread.id === MAIN_THREAD) ?? working[0];
    status = { ...status, state, activity: state === "idle" || !current ? null : (doing.get(current.id) ?? null), pendingRequests, workingThreads: working.length };
    push({ type: "node.status", status });
  }

  function setThread(threadId: string, patch: Partial<Thread>) {
    const thread = threads.get(threadId);
    if (!thread) return;
    threads.set(threadId, { ...thread, ...patch, updatedAt: Date.now() });
    push({ type: "thread.updated", thread: threads.get(threadId)! });
  }

  function createThread(thread: Pick<Thread, "id" | "kind" | "title"> & Partial<Thread>, at = Date.now()) {
    threads.set(thread.id, { parentId: thread.kind === "job" ? MAIN_THREAD : null, cwd: null, state: "idle", preview: null, createdAt: at, updatedAt: at, ...thread });
    items.set(thread.id, []);
  }

  const add = <T extends Item>(item: T): T => {
    items.get(item.threadId)?.push(item);
    push({ type: "item.added", item });
    return item;
  };
  const update = (item: Item) => {
    const timeline = items.get(item.threadId) ?? [];
    timeline[timeline.findIndex((other) => other.id === item.id)] = item;
    push({ type: "item.updated", item });
  };

  // ───────────── What the script is written with ─────────────

  const message = (threadId: string, role: MessageItem["role"], text: string, at = Date.now()): MessageItem => ({
    id: id("msg"), threadId, at, type: "message", role, text, via: "text", deviceId: null, files: [],
  });
  const activity = (threadId: string, label: string, detail: string | null, at = Date.now()): ActivityItem => ({
    id: id("act"), threadId, at, type: "activity", label, tool: null, detail, state: "running", endedAt: null,
  });
  const request = (threadId: string, question: Question, at = Date.now()): RequestItem => {
    const { shot, ...rest } = question;
    const file: FileRef | null = shot && { id: `file_${shot}`, mime: "image/svg+xml", width: 1280, height: 800 };
    return { id: id("req"), threadId, at, type: "request", ...rest, screenshot: file, state: "pending", resolution: null };
  };

  /** The agent says something, a few letters at a time. */
  async function says(threadId: string, text: string, signal: AbortSignal) {
    const item = message(threadId, "agent", text);
    for (let i = 0; i < text.length; ) {
      const chunk = text.slice(i, (i += 2 + Math.floor(Math.random() * 4)));
      push({ type: "message.delta", threadId, messageId: item.id, text: chunk }, true);
      await sleep(28, signal);
    }
    item.at = Date.now();
    add(item);
    setThread(threadId, { preview: text });
  }

  /** The agent does something that takes a while. */
  async function does(threadId: string, label: string, ms: number, signal: AbortSignal, detail: string | null = null) {
    const item = add(activity(threadId, label, detail));
    doing.set(threadId, label);
    refreshStatus();
    await sleep(ms, signal);
    update({ ...item, state: "done", endedAt: Date.now() });
  }

  /** The agent needs its owner, and waits for the answer. */
  async function asks(threadId: string, question: Question, signal: AbortSignal): Promise<RequestResolution> {
    const item = add(request(threadId, question));
    setThread(threadId, { state: "waiting", preview: question.title });
    refreshStatus();
    const resolution = await new Promise<RequestResolution>((resolve, reject) => {
      answers.set(item.id, resolve);
      signal.addEventListener("abort", () => reject(signal.reason));
    });
    setThread(threadId, { state: "working" });
    refreshStatus();
    return resolution;
  }

  /** Runs a script as one turn of a thread; `interrupt` cuts it short. */
  function run(threadId: string, script: (signal: AbortSignal) => Promise<void>) {
    runs.get(threadId)?.abort(new Error("superseded"));
    const control = new AbortController();
    runs.set(threadId, control);
    setThread(threadId, { state: "working" });
    refreshStatus();
    void script(control.signal).then(
      () => true,
      () => false,
    ).then((ok) => {
      if (runs.get(threadId) !== control) return;
      runs.delete(threadId);
      // Whatever was left hanging ends with the turn.
      for (const item of [...(items.get(threadId) ?? [])]) {
        if (item.type === "activity" && item.state === "running") update({ ...item, state: ok ? "done" : "failed", endedAt: Date.now() });
        if (item.type === "request" && item.state === "pending") update({ ...item, state: "cancelled" });
      }
      setThread(threadId, { state: "idle" });
      doing.delete(threadId);
      refreshStatus();
      const last = (items.get(threadId) ?? []).findLast((item) => item.type === "message" && item.role === "agent");
      push({ type: "turn.completed", threadId, ok, text: last?.type === "message" ? last.text : "" });
    });
  }

  // ───────────── The story ─────────────

  const deploy: Question = {
    kind: "question",
    // No-break spaces before the dashes: a title never starts a line with one.
    title: say("Everything looks good\u00a0— deploy to production?", "Tout est prêt\u00a0— je mets en production ?"),
    body: say("The new prices are on the page and all 48 tests pass.", "Les nouveaux prix sont sur la page et les 48 tests passent."),
    spoken: say("Everything looks good. Shall I deploy to production?", "Tout est prêt. Je mets en production ?"),
    risk: "medium",
    options: [
      { id: "deploy", label: say("Deploy", "Mettre en ligne"), style: "primary" },
      { id: "later", label: say("Not yet", "Pas encore"), style: "default" },
    ],
    allowText: true,
    shot: "site",
  };
  // For an approval, `body` is the raw input of the step (it goes under "Details").
  const payment: Question = {
    kind: "approval",
    title: say("Pay €240.00 to Durand Plomberie?", "Payer 240,00 € à Durand Plomberie ?"),
    body: say(
      'click "Confirm transfer"\n  in      Safari, banque-rivage.fr/transfers/new\n  amount  €240.00\n  to      Durand Plomberie\n  ref     Invoice 2231',
      'click "Confirmer le virement"\n  dans     Safari, banque-rivage.fr/virements/nouveau\n  montant  240,00 €\n  à        Durand Plomberie\n  réf      Facture 2231',
    ),
    spoken: say("I’d like to pay €240 to Durand Plomberie. Can I go ahead?", "J’aimerais payer 240 € à Durand Plomberie. Je peux y aller ?"),
    risk: "high",
    options: [
      { id: APPROVE, label: say("Go ahead", "Allez-y"), style: "primary" },
      { id: DENY, label: say("Stop", "Stop"), style: "danger" },
    ],
    allowText: false,
    shot: "bank",
  };
  const cleanup: Question = {
    kind: "approval",
    title: say("Delete 214 old files from Downloads?", "Supprimer 214 anciens fichiers des Téléchargements ?"),
    body: "find ~/Downloads -type f -mtime +180 -delete\n  214 files · 3.2 GB",
    spoken: say("I found 214 files in Downloads you haven’t opened in six months. Can I delete them?", "J’ai trouvé 214 fichiers dans Téléchargements que vous n’avez pas ouverts depuis six mois. Je peux les supprimer ?"),
    risk: "medium",
    options: payment.options,
    allowText: false,
    shot: null,
  };
  const replace: Question = {
    kind: "question",
    title: say("Replace last week’s backup, or keep both?", "Remplacer la sauvegarde de la semaine dernière, ou garder les deux ?"),
    body: say("Keeping both needs 48 GB more on the backup disk.", "Garder les deux demande 48 Go de plus sur le disque de sauvegarde."),
    spoken: say("Should I replace last week’s backup, or keep both?", "Je remplace la sauvegarde de la semaine dernière, ou je garde les deux ?"),
    risk: "low",
    options: [
      { id: "replace", label: say("Replace it", "La remplacer"), style: "primary" },
      { id: "both", label: say("Keep both", "Garder les deux"), style: "default" },
    ],
    allowText: false,
    shot: null,
  };

  /** What already happened before the page opened. */
  function history() {
    const at = (minutesAgo: number) => started - minutesAgo * MINUTE;
    const past = (item: Item) => items.get(item.threadId)?.push(item);
    const done = (label: string, minutesAgo: number, threadId = MAIN_THREAD) =>
      past({ ...activity(threadId, label, null, at(minutesAgo)), state: "done", endedAt: at(minutesAgo) + 4000 });

    past({ ...message(MAIN_THREAD, "user", say("Can you find last month’s electricity bill and send it to my accountant?", "Tu peux retrouver la facture d’électricité du mois dernier et l’envoyer à ma comptable ?"), at(95)), via: "voice", deviceId: "dev_phone" });
    done(say("Searching Mail", "Recherche dans Mail"), 95);
    done(say("Opening the bill", "Ouverture de la facture"), 94);
    done(say("Writing to Claire Martin", "Rédaction du message à Claire Martin"), 94);
    past(message(MAIN_THREAD, "agent", say("Found it: **March, €84.20**. The email to Claire is ready, with the bill attached.", "Je l’ai : **mars, 84,20 €**. Le message pour Claire est prêt, avec la facture en pièce jointe."), at(93)));
    past({
      ...request(MAIN_THREAD, {
        kind: "approval",
        title: say("Send this email to Claire Martin?", "Envoyer ce message à Claire Martin ?"),
        body: null,
        spoken: say("The email to Claire is ready. Shall I send it?", "Le message pour Claire est prêt. Je l’envoie ?"),
        risk: "medium",
        options: payment.options,
        allowText: false,
        shot: null,
      }, at(93)),
      state: "resolved",
      resolution: { optionId: APPROVE, text: null, deviceId: "dev_phone", at: at(92) },
    });
    past(message(MAIN_THREAD, "agent", say("Sent. I also filed the bill in Documents › Invoices.", "Envoyé. J’ai aussi rangé la facture dans Documents › Factures."), at(92)));

    createThread({ id: "thr_photos", kind: "job", title: say("Holiday photos", "Photos de vacances"), preview: say("2,418 photos sorted into albums", "2 418 photos classées en albums") }, at(180));
    done(say("Reading the camera roll", "Lecture de la pellicule"), 180, "thr_photos");
    done(say("Grouping by place and day", "Regroupement par lieu et par jour"), 170, "thr_photos");
    past(message("thr_photos", "agent", say("All done: 2,418 photos sorted into 14 albums. The largest:\n\n- **Brittany, July** — 412 photos\n- **Lisbon** — 268 photos\n- **Léa’s birthday** — 97 photos\n\nNothing was deleted. The originals are still in `~/Pictures/Import`.", "C’est fait : 2 418 photos classées en 14 albums. Les plus gros :\n\n- **Bretagne, juillet** — 412 photos\n- **Lisbonne** — 268 photos\n- **Anniversaire de Léa** — 97 photos\n\nRien n’a été supprimé. Les originaux sont toujours dans `~/Pictures/Import`."), at(150)));
  }

  const launchAsk = say("The website needs the new prices before Friday’s launch. Can you take care of it?", "Le site doit afficher les nouveaux prix avant le lancement de vendredi. Tu peux t’en occuper ?");

  /** The long piece of work shown by `?demo=working`. */
  async function launch(signal: AbortSignal) {
    await says(MAIN_THREAD, say("On it. I’ll update the page, run the checks, and ask you before anything goes live.", "Je m’en occupe. Je mets la page à jour, je lance les vérifications, et je vous demande avant toute mise en ligne."), signal);
    await does(MAIN_THREAD, say("Opening the project", "Ouverture du projet"), 1400, signal, "~/Sites/atelier");
    await does(MAIN_THREAD, say("Updating the pricing page", "Mise à jour de la page des prix"), 2600, signal);
    await does(MAIN_THREAD, say("Running the tests", "Lancement des tests"), 14_000, signal, "npm test");
    const answer = await asks(MAIN_THREAD, deploy, signal);
    if (answer.optionId !== "deploy") {
      return says(MAIN_THREAD, say("No problem. It’s ready whenever you are.", "Très bien. C’est prêt quand vous voulez."), signal);
    }
    await does(MAIN_THREAD, say("Deploying", "Mise en ligne"), 3200, signal);
    await says(MAIN_THREAD, say("It’s live at [atelier-lumen.com](https://atelier-lumen.com). The page loads and the checkout still works.", "C’est en ligne sur [atelier-lumen.com](https://atelier-lumen.com). La page s’affiche et le paiement fonctionne toujours."), signal);
  }

  /** A job that keeps going in the background. */
  async function backup(signal: AbortSignal) {
    const steps = [say("Comparing with last week", "Comparaison avec la semaine dernière"), say("Copying new files", "Copie des nouveaux fichiers"), say("Checking the copy", "Vérification de la copie")];
    for (const step of steps) {
      setThread("thr_backup", { preview: step });
      await does("thr_backup", step, 16_000, signal);
    }
    await says("thr_backup", say("The backup is complete: 312 new files, all verified.", "La sauvegarde est terminée : 312 nouveaux fichiers, tous vérifiés."), signal);
  }

  /** The bank transfer of `?demo=waiting`. */
  async function pay(signal: AbortSignal) {
    const answer = await asks(MAIN_THREAD, payment, signal);
    if (answer.optionId !== APPROVE) {
      return says(MAIN_THREAD, say("Understood. I’ve left the transfer unsent.", "Compris. Je n’ai pas envoyé le virement."), signal);
    }
    await does(MAIN_THREAD, say("Confirming the transfer", "Confirmation du virement"), 2400, signal);
    await says(MAIN_THREAD, say("Paid. The receipt is in Documents › Invoices.", "Payé. Le reçu est dans Documents › Factures."), signal);
  }

  /** What any message gets in reply: the demo cannot really do things. */
  async function reply(signal: AbortSignal) {
    await sleep(700, signal);
    await does(MAIN_THREAD, say("Looking at the screen", "Observation de l’écran"), 1600, signal);
    await does(MAIN_THREAD, say("Thinking it through", "Réflexion"), 1300, signal);
    await says(MAIN_THREAD, say("This is a demo, so I can’t really do that. On your own computer, I’d already be on it.", "Ceci est une démonstration, je ne peux donc pas vraiment le faire. Sur votre ordinateur, je serais déjà au travail."), signal);
  }

  async function greet(signal: AbortSignal) {
    await sleep(900, signal);
    await says(MAIN_THREAD, say(`Hello ${node.owner.name}. I’m ${node.agent.name}. Tell me what you need, and I’ll take care of it.`, `Bonjour ${node.owner.name}. Je suis ${node.agent.name}. Dites-moi ce dont vous avez besoin, je m’en occupe.`), signal);
  }

  /** The question of `?demo=question`, without the wait. */
  async function decide(signal: AbortSignal) {
    const answer = await asks(MAIN_THREAD, deploy, signal);
    if (answer.optionId === "deploy") {
      await does(MAIN_THREAD, say("Deploying", "Mise en ligne"), 3200, signal);
      return says(MAIN_THREAD, say("It’s live. The page loads and the checkout still works.", "C’est en ligne. La page s’affiche et le paiement fonctionne toujours."), signal);
    }
    await says(MAIN_THREAD, answer.text ? say("Understood. I’ll keep that in mind.", "Entendu. Je m’en souviendrai.") : say("No problem. It’s ready whenever you are.", "Très bien. C’est prêt quand vous voulez."), signal);
  }

  /** The tidy-up of `?demo=approval`. */
  async function tidy(signal: AbortSignal) {
    const answer = await asks(MAIN_THREAD, cleanup, signal);
    if (answer.optionId !== APPROVE) return says(MAIN_THREAD, say("Okay, I left them where they are.", "D’accord, je les laisse où ils sont."), signal);
    await does(MAIN_THREAD, say("Deleting old files", "Suppression des anciens fichiers"), 2200, signal, "find ~/Downloads -mtime +180 -delete");
    await says(MAIN_THREAD, say("Done: 3.2 GB freed.", "C’est fait : 3,2 Go libérés."), signal);
  }

  /** The backup of `?demo=job`, which needs a decision. */
  async function backupAsks(signal: AbortSignal) {
    setThread("thr_backup", { preview: say("Comparing with last week", "Comparaison avec la semaine dernière") });
    await does("thr_backup", say("Comparing with last week", "Comparaison avec la semaine dernière"), 900, signal);
    const answer = await asks("thr_backup", replace, signal);
    await does("thr_backup", answer.optionId === "both" ? say("Copying everything", "Copie de tout") : say("Replacing last week’s copy", "Remplacement de la copie de la semaine dernière"), 16_000, signal);
    await says("thr_backup", say("The backup is complete.", "La sauvegarde est terminée."), signal);
  }

  function begin() {
    if (scenario === "working" || scenario === "waiting" || scenario === "question" || scenario === "approval") {
      createThread({ id: "thr_backup", kind: "job", title: say("Weekly backup", "Sauvegarde de la semaine") });
      run("thr_backup", backup);
    }
    if (scenario === "job") {
      createThread({ id: "thr_backup", kind: "job", title: say("Weekly backup", "Sauvegarde de la semaine") });
      run("thr_backup", backupAsks);
    }
    if (scenario === "question") {
      add(message(MAIN_THREAD, "user", launchAsk));
      const at = Date.now();
      for (const label of [say("Opening the project", "Ouverture du projet"), say("Updating the pricing page", "Mise à jour de la page des prix"), say("Running the tests", "Lancement des tests")]) {
        add({ ...activity(MAIN_THREAD, label, null, at), state: "done", endedAt: at });
      }
      run(MAIN_THREAD, decide);
    }
    if (scenario === "approval") {
      add(message(MAIN_THREAD, "user", say("My Mac says the disk is almost full. Can you make some room?", "Mon Mac dit que le disque est presque plein. Tu peux faire de la place ?")));
      const at = Date.now();
      for (const label of [say("Measuring the disk", "Mesure du disque"), say("Looking through Downloads", "Examen des Téléchargements")]) {
        add({ ...activity(MAIN_THREAD, label, null, at), state: "done", endedAt: at });
      }
      run(MAIN_THREAD, tidy);
    }
    if (scenario === "working") {
      add(message(MAIN_THREAD, "user", launchAsk));
      run(MAIN_THREAD, launch);
    }
    if (scenario === "waiting") {
      add(message(MAIN_THREAD, "user", say("The plumber’s invoice is in my inbox. Can you pay it?", "La facture du plombier est dans ma boîte mail. Tu peux la payer ?")));
      const at = Date.now();
      for (const label of [say("Opening the invoice", "Ouverture de la facture"), say("Signing in to the bank", "Connexion à la banque"), say("Filling in the transfer", "Saisie du virement")]) {
        add({ ...activity(MAIN_THREAD, label, null, at), state: "done", endedAt: at });
      }
      run(MAIN_THREAD, pay);
    }
  }

  createThread({ id: MAIN_THREAD, kind: "main", title: node.agent.name }, started - 24 * 60 * MINUTE);
  if (!fresh) history();

  // ───────────── The client ─────────────

  const forbidden = () => new ApiFailure("forbidden", "Only on the computer itself.");
  const local = <T>(value: () => T): Promise<T> => (options.remote ? Promise.reject(forbidden()) : Promise.resolve(value()));

  const nodeResponse = () => ({ node, status, local: !options.remote });

  return {
    node: async () => nodeResponse(),
    updateNode: (patch) =>
      local(() => {
        const wasNew = !node.onboarded;
        node = {
          ...node,
          name: patch.name ?? node.name,
          agent: { name: patch.agentName ?? node.agent.name },
          owner: { name: patch.ownerName ?? node.owner.name },
          language: patch.language ?? node.language,
          autonomy: patch.autonomy ?? node.autonomy,
          onboarded: patch.onboarded ?? node.onboarded,
        };
        push({ type: "node.updated", node });
        if (wasNew && node.onboarded) run(MAIN_THREAD, greet);
        return nodeResponse();
      }),
    async setMode(mode) {
      status = { ...status, mode };
      push({ type: "node.status", status });
      return nodeResponse();
    },
    settings: () => local(() => settings),
    updateSettings: (patch) =>
      local(() => {
        const { engine = {}, voice = {}, network = {} } = patch;
        const relayUrl = network.relayUrl === undefined ? settings.network.relayUrl : network.relayUrl;
        // A relay answers when its address looks like one.
        const reachable = relayUrl !== null && /^https?:\/\/\S+\.\S+/.test(relayUrl);
        const direct = settings.network.urls.filter((url) => !url.includes("/n/"));
        // Without a key of its own, a Claude already set up on the computer (when there is one) takes over.
        const keyed = engine.apiKey === undefined ? settings.engine.auth === "api-key" : engine.apiKey !== "";
        const ready = keyed || options.account;
        const provider = voice.provider ?? settings.voice.provider;
        const sameVoice = provider === settings.voice.provider;
        settings = {
          ...settings,
          engine: {
            ...settings.engine,
            model: engine.model === undefined ? settings.engine.model : engine.model,
            hasWorkspaceId: engine.workspaceId === undefined ? settings.engine.hasWorkspaceId : engine.workspaceId !== "",
            ready,
            auth: keyed ? "api-key" : options.account ? "environment" : "none",
          },
          voice: {
            ...settings.voice,
            provider,
            // Each provider has its own key and its own voices.
            hasKey: voice.apiKey === undefined ? sameVoice && settings.voice.hasKey : voice.apiKey !== "",
            voice: voice.voice === undefined ? (sameVoice ? settings.voice.voice : null) : voice.voice,
            url: voice.url === undefined ? settings.voice.url : voice.url,
          },
          network: {
            ...settings.network,
            urls: reachable ? [...direct, `${relayUrl.replace(/\/+$/, "")}/n/${node.id}`] : direct,
            relayUrl,
            relayConnected: reachable,
            relayError: relayUrl === null || reachable ? null : say("That address does not answer. Check it and try again.", "Cette adresse ne répond pas. Vérifiez-la et réessayez."),
            hasRelayToken: network.relayToken === undefined ? settings.network.hasRelayToken : network.relayToken !== "",
          },
        };
        node = { ...node, capabilities: { ...node.capabilities, engineReady: ready } };
        push({ type: "node.updated", node });
        return settings;
      }),
    async requestPermissions() {
      // As if the owner clicked through the system dialog: one permission per ask.
      await sleep(1200);
      const { screenRecording } = settings.computer.permissions;
      const permissions = screenRecording ? { screenRecording, accessibility: true } : { ...settings.computer.permissions, screenRecording: true };
      settings = { ...settings, computer: { permissions } };
      return permissions;
    },
    createPairingCode: () =>
      local(() => {
        const code = String(100_000 + Math.floor(Math.random() * 900_000));
        if (!phoneOnItsWay) {
          phoneOnItsWay = true;
          void sleep(7000).then(() => {
            const name = devices.some((device) => device.platform === "ios") ? "Pixel 9" : say("Alex’s iPhone", "iPhone d’Alex");
            devices = [...devices, { id: id("dev"), name, platform: name === "Pixel 9" ? "android" : "ios", createdAt: Date.now(), lastSeenAt: Date.now() }];
            phoneOnItsWay = false;
          });
        }
        const link = encodePairingLink({ code, nodeId: node.id, name: node.name, urls: settings.network.urls, fingerprint: "5e".repeat(32) });
        return { code, expiresAt: Date.now() + 5 * MINUTE, link };
      }),
    devices: async () => devices,
    removeDevice: (deviceId) => local(() => (devices = devices.filter((device) => device.id !== deviceId))),
    threads: async () => [...threads.values()],
    async items(threadId) {
      const thread = threads.get(threadId);
      if (!thread) throw new ApiFailure("not_found", "No such conversation.");
      return { thread, items: [...(items.get(threadId) ?? [])], hasMore: false };
    },
    async send(threadId, text) {
      const item = add(message(threadId, "user", text));
      if (!runs.has(threadId)) run(threadId, threadId === MAIN_THREAD ? reply : async () => {});
      return item;
    },
    async interrupt(threadId) {
      runs.get(threadId)?.abort(new Error("interrupted"));
    },
    requests: async () => [...items.values()].flat().filter((item): item is RequestItem => item.type === "request" && item.state === "pending"),
    async resolve(requestId, optionId, text) {
      const item = [...items.values()].flat().find((other) => other.id === requestId);
      if (item?.type !== "request" || item.state !== "pending") throw new ApiFailure("conflict", "Already answered.");
      const resolved: RequestItem = { ...item, state: "resolved", resolution: { optionId, text, deviceId: null, at: Date.now() } };
      update(resolved);
      answers.get(requestId)?.(resolved.resolution!);
      answers.delete(requestId);
      return resolved;
    },
    async fileUrl(file) {
      if (!shots.has(file.id)) shots.set(file.id, screenshot(file.id.replace("file_", "") as Shot, french));
      return shots.get(file.id)!;
    },
    events(_since, onFrame, onDown) {
      const timer = setTimeout(() => {
        emit = onFrame;
        onFrame({ type: "ready", seq, reset: false, ...nodeResponse() });
        if (!begun) begin();
        begun = true;
      }, 250);
      // `?demo=offline`: the computer goes quiet a moment later, and stays so.
      const down = scenario === "offline" ? setTimeout(() => ((emit = () => {}), onDown()), 900) : 0;
      return () => {
        clearTimeout(timer);
        clearTimeout(down);
        emit = () => {};
      };
    },
  };
}
