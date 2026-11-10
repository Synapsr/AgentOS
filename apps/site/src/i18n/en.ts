/**
 * Every word on the English site. The French site (fr.ts) has the same
 * shape. Vocabulary follows docs/DESIGN.md ("Words"): your computer, Nova is
 * asking, Go ahead / Stop, no exclamation marks. The home page speaks to
 * anyone; commands, relays and diagrams live on the developers' page.
 */
export const en = {
  lang: "en",
  locale: "en_US",
  path: "/",
  devPath: "/developers/",

  meta: {
    title: "AgentOS — Give an AI agent your computer. Talk to it from anywhere.",
    description:
      "An open-source app that gives an AI agent your computer, and lets you talk to it from your phone or your earbuds, as simply as talking to a person. An early version for the Mac, free and open source.",
    cardAlt: "AgentOS: three drops of light on black, and the words “Give an AI agent your computer. Talk to it from anywhere.”",
    devTitle: "AgentOS for developers — Run it from source, host your own relay",
    devDescription:
      "Build AgentOS from source, see how its parts fit together, and reach your computer from anywhere with your own relay. Open source, MIT.",
  },

  nav: {
    label: "Sections",
    skip: "Skip to content",
    home: "AgentOS, home",
    links: [
      { href: "#feel", label: "How it feels" },
      { href: "#charge", label: "You stay in charge" },
      { href: "#privacy", label: "Privacy" },
    ],
    developers: "For developers",
    language: "Français",
    languageShort: "FR",
    github: "GitHub",
  },

  hero: {
    title: ["Give an AI agent your computer.", "Talk to it from anywhere."],
    lead:
      "AgentOS lives on your Mac and does the work there. You talk to it from your phone or your earbuds, the way you would talk to a person, and it checks with you before the risky steps.",
    primary: "Get AgentOS",
    secondary: "See it at work",
    facts: "An early version, for the Mac. Free and open source. No AgentOS account: Nova thinks with a Claude key you add once.",
    question: "Send this email to Claire Martin?",
    detail: "The March bill, €84.20, is attached.",
  },

  /** The words of a request, the same wherever one is shown. */
  request: {
    asking: "Nova is asking",
    now: "now",
    go: "Go ahead",
    stop: "Stop",
    youSaid: "You said “{answer}”",
    again: "Ask again",
    risk: "Worth a careful look",
    details: "Details",
    lookCloser: "Look closer",
    close: "Close",
  },

  see: {
    title: "Someone at your computer, even when you’re not.",
    body:
      "AgentOS gives an AI agent the whole computer: it sees the screen, clicks, types and works on your files. You ask from your phone, the way you would ask a person. Nova does the work, tells you how it went, and stops to ask before the risky steps.",
  },

  /** The scene beside it: one short conversation, played on a phone. */
  scene: {
    label: "A short scene on a phone: Alex asks Nova for something, Nova works on the computer at home, then asks before deploying.",
    caption: "Alex is out for a run. Nova is at home, on the Mac.",
    agent: "Nova",
    time: "7:42",
    live: "Earbuds",
    placeholder: "Talk to Nova…",
    greeting: "Good morning, Alex.",
    listening: "I’m listening.",
    ask: "Can you put the new prices on the website?",
    onIt: "On it. I’ll check with you before it goes live.",
    steps: ["Updating the prices", "Running the tests", "Checking the staging site"],
    asking: "Nova is asking",
    question: "Everything looks good.\nCan I deploy to production?",
    answer: "Go ahead.",
    saidAloud: "Said aloud",
    deploying: "Deploying now.",
    deployStep: "Deploying to production",
    done: "Done. It’s live.",
    stopped: "Okay. It’s ready whenever you are.",
    go: "Go ahead",
    stop: "Stop",
    chapters: ["You ask", "Nova works", "Nova asks", "You answer"],
    play: "Play the scene",
    pause: "Pause the scene",
    replay: "Play the scene again",
    chapter: "Go to “{name}”",
    shot: {
      label: "What Nova sees: the staging website, with all 212 tests passing.",
      url: "staging.orchard-bikes.example",
      brand: "Orchard Bikes",
      headline: "Ready for the first warm days.",
      badge: "All 212 tests pass",
      tiles: ["City", "Gravel", "Kids"],
    },
  },

  feel: {
    title: "Like handing your computer to someone you trust.",
    os: {
      title: "Hand it the screen.",
      body:
        "Your screen goes dark and calm. Only Nova is left, with one line about what it is doing. Move the pointer and you can take back control at any moment.",
      aside: "Rather keep working? The side panel keeps Nova at the edge of your screen instead.",
      name: "Nova",
      line: "Filing last month’s receipts",
      hint: "Take back control",
      label: "OS mode: a dark screen with Nova at work, filing last month’s receipts.",
    },
    watch: {
      title: "Answer out loud.",
      body:
        "With earbuds in, Nova asks out loud and you simply answer, phone in your pocket. An Apple Watch companion is being built, for the same question on your wrist.",
      note: "Speech runs on your phone by default, with no key.",
      progress: "In progress",
      question: "Send the quote to Claire?",
      label: "The Apple Watch companion, in progress: Nova’s question, with Go ahead and Stop.",
    },
  },

  charge: {
    title: "You stay in charge.",
    lead:
      "Before a step it knows is risky, such as paying, deleting files or publishing, Nova stops and asks, with a picture of what it sees. Stopping is always one tap or one word.",
    try: "Try it: the buttons work.",
    question: "Pay €240.00 to Durand Plomberie?",
    raw: "computer_click  ref e42\n# button “Confirm transfer”\n# Safari, Banque Rivage",
    shot: {
      label: "What Nova sees: the bank’s transfer form, filled in, before confirming.",
      bank: "Banque Rivage",
      title: "New transfer",
      amountLabel: "Amount",
      amount: "€240.00",
      rows: [
        ["To", "Durand Plomberie"],
        ["Reference", "Invoice 2231"],
        ["From", "Current account"],
      ],
      cancel: "Cancel",
      confirm: "Confirm transfer",
    },
    autonomy: {
      title: "How much should Nova ask?",
      help: "One setting, three positions. You can change it at any time.",
      recommended: "Recommended",
      options: [
        { value: "supervised", label: "Ask before every change", help: "Nova checks with you before changing anything on your computer." },
        { value: "balanced", label: "Ask when it matters", help: "Nova works on its own, and asks before the risky steps it recognises." },
        { value: "autonomous", label: "Never stop to ask", help: "Nothing holds Nova back. It may still ask what you prefer." },
      ],
    },
    caution: {
      lead: "An agent that can use your whole computer can be misled by what it reads.",
      body: "A web page, an email or a file can try to steer it. Asking first reduces that risk; it does not remove it. Start with “Ask before every change”, and loosen it once you trust it.",
    },
  },

  privacy: {
    title: "Your computer, your keys.",
    lead:
      "AgentOS has no account and no server of its own. Your devices talk to your computer, and your computer talks only to the services you chose: the model that thinks, and a voice if you add one.",
    points: [
      {
        title: "Only the devices you add.",
        body: "A device gets in only with the one-time code shown on your computer. At home, the connection is encrypted with your computer’s own certificate, checked every time.",
      },
      {
        title: "Your keys stay on your computer.",
        body: "API keys are kept in one file only you can read, and never handed out, not even to your phone.",
      },
      {
        title: "Open source, MIT.",
        body: "Every line is on GitHub. Read it, change it, run it yourself.",
      },
    ],
  },

  today: {
    title: "Early, and honest about it.",
    lead:
      "AgentOS is at version 0.1. The whole loop works — you ask, it works, it asks back, you answer — and some edges are still rough.",
    now: {
      title: "Works today",
      items: [
        "The app for macOS",
        "The iPhone app",
        "The web client, in any browser",
        "Claude as the brain",
        "Voice on your phone, with ElevenLabs, or your own speech server",
        "Same network, Tailscale, or your own relay",
        "English and French",
      ],
    },
    next: {
      title: "Next",
      items: ["An Apple Watch companion, being built now", "Windows and Linux", "Android", "End-to-end encryption through a relay"],
    },
    gallery: "A recording and real screens from version 0.1: OS mode, the side panel, and the web client on a phone.",
    video: "OS mode, recorded from version 0.1: Nova runs the tests, asks before deploying, then deploys.",
  },

  get: {
    title: "Give it a computer. Then go for a run.",
    body: "AgentOS is an early version, for the Mac. Download the app, open it, and answer a few questions. It is free and open source.",
    primary: "Download for Mac",
    secondary: "Build it from source",
    key: "Nova thinks with Claude, so you will need a Claude key, added once. You get it from Anthropic, who bill what Nova uses. AgentOS itself is free.",
    setup: "Then a few questions, your Claude key, and one code for your phone.",
    steps: [
      { caption: "Your name", question: "What’s your name?", value: "Alex" },
      { caption: "How much it asks", question: "How much should Nova ask?", value: "" },
      { caption: "Its brain", question: "Give Nova a brain", value: "" },
      { caption: "Your phone", question: "Add your phone", value: "Scan this code to talk to Nova from anywhere." },
    ],
    qrLabel: "A QR code. This one opens the AgentOS repository on GitHub.",
  },

  developers: {
    title: "Built in the open. Run it yourself.",
    lead:
      "AgentOS is small, open source and MIT. Build it from source, see how the parts fit together, and reach your computer from anywhere with your own relay.",
    jump: [
      { href: "#start", label: "Quick start" },
      { href: "#how", label: "How it works" },
      { href: "#connect", label: "Self-hosting" },
    ],
    back: "Back to AgentOS",
  },

  how: {
    title: "Three parts. Each one replaceable.",
    lead:
      "AgentOS is small on purpose. The core runs on your computer and keeps the conversation, the requests and the safety rules. Everything else plugs into it.",
    you: { title: "You", body: "iPhone, earbuds or any browser, and soon Apple Watch" },
    wire: "One small, documented protocol",
    core: { title: "Your computer", body: "The AgentOS core: conversations, requests, safety rules, plain files." },
    parts: [
      {
        title: "The brain",
        body: "Claude, through the Claude Agent SDK. The engine is an interface, so other models can plug in.",
        options: ["Claude"],
        open: "Your model, same interface",
      },
      {
        title: "Eyes and hands",
        body: "Your operating system’s accessibility tree, through the open-source agent-desktop. Nova reads what is on screen and acts on it: buttons, fields, menus.",
        options: ["agent-desktop"],
        open: "",
      },
      {
        title: "Ears and mouth",
        body: "Speech on your phone by default, with no key. Add one key for a premium voice such as ElevenLabs, or point it at your own open-source speech server.",
        options: ["Your phone", "ElevenLabs", "Your own server"],
        open: "",
      },
    ],
    clients: ["iPhone", "Earbuds", "Browser"],
    soon: "Apple Watch, in progress",
  },

  connect: {
    title: "Reach your computer from anywhere, your way.",
    lead: "Your phone and your computer talk to each other directly. Pick whichever of the three suits you.",
    ways: [
      { title: "On the same network", body: "At home or at work, your phone finds your computer by itself, and the connection is encrypted with your computer’s own certificate." },
      { title: "Anywhere, with Tailscale", body: "Install Tailscale on both. AgentOS notices and puts that address in the pairing code. Tailscale encrypts the connection, and there is no server to run." },
      {
        title: "Anywhere, with your own relay",
        body: "Run one small container on a server you own. It is private: it only accepts computers that present its token. Your computer connects out to it, so nothing opens on your home network.",
      },
    ],
    relayLabel: "Your own relay.",
    relayBuild: "There is no published image yet, so you build it from your clone; one will come with the first release.",
    relayNote: "Then give your computer the relay’s address and its token, in Settings › Advanced. Whoever runs a relay can read what passes through it, so run your own. End-to-end encryption between phone and computer is planned.",
    computers: {
      title: "More than one computer?",
      body: "Pair each one. Your phone shows them together, each with its own agent.",
      label: "Your computers",
      rows: [
        { name: "Nova", where: "Studio Mac", line: "Running the tests", state: "working" },
        { name: "Iris", where: "MacBook Air", line: "Nothing to do", state: "idle" },
        { name: "Atlas", where: "Office Mac mini", line: "Can’t reach your computer", state: "offline" },
      ],
      jobs: "With each agent, one conversation on top, and as many background jobs as it needs underneath.",
    },
  },

  start: {
    title: "Run it from source.",
    lead: "Rather build it yourself? You need a Mac, Node.js 20.19 or later, and pnpm 10.",
    steps: [
      { label: "Get the code and build it", code: "git clone https://github.com/Synapsr/AgentOS.git\ncd AgentOS\npnpm install\npnpm build" },
      { label: "Wake the agent, with no key yet", code: "AGENTOS_ENGINE=mock pnpm start", note: "A practice brain: no key, no cost, everything else real. It prints the address where you finish setting up." },
      { label: "Give it a real brain", code: "pnpm start", note: "Runs agentos start, the core alone. Paste an Anthropic API key during setup, or later in Settings." },
      { label: "Add your phone", code: "pnpm agentos pair", note: "Shows a one-time QR code." },
    ],
    more: [
      { label: "From a terminal", text: "pnpm agentos say \"…\"", note: "Also status, pair and url." },
      { label: "The desktop app", text: "pnpm desktop", note: "Tauri 2, so you need Rust." },
      { label: "The iPhone app", text: "cd apps/ios && xcodegen", note: "Then open the project in Xcode." },
    ],
    copy: "Copy",
    copied: "Copied",
    files: {
      title: "Everything is a plain file.",
      body: "No database. What Nova knows lives in ~/.agentos, readable with any editor.",
      tree: [
        ["config.json", "who the agent is, how much it asks"],
        ["secrets.json", "API keys, readable only by you"],
        ["devices.json", "paired devices, token hashes only"],
        ["events.jsonl", "everything that happened"],
        ["threads/", "one file per conversation"],
        ["files/", "screenshots and other files"],
      ],
    },
    protocol: {
      title: "One small protocol.",
      body: "HTTP and WebSocket, in JSON, defined in packages/protocol. Every client speaks it: the apps, the web client, your scripts.",
    },
    links: [
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/ARCHITECTURE.md", label: "Architecture" },
      { href: "https://github.com/Synapsr/AgentOS/tree/main/packages/protocol", label: "The protocol" },
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/DESIGN.md", label: "Design system" },
    ],
  },

  footer: {
    tagline: "Give an AI agent your computer. Talk to it from anywhere.",
    license: "Open source under the MIT licence.",
    links: [
      { href: "https://github.com/Synapsr/AgentOS", label: "GitHub" },
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/ARCHITECTURE.md", label: "Architecture" },
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/DESIGN.md", label: "Design" },
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/PRESENCE.md", label: "The presence" },
    ],
  },
};
