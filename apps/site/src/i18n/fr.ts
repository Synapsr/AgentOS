/**
 * Every word on the French site. The site, like the product, addresses its
 * reader with « vous », buttons included (« Allez-y »). In the scene Alex
 * speaks to Nova with « vous » too, so that the answer said aloud is the
 * button's own word.
 */
import type { Copy } from "./index";

export const fr: Copy = {
  lang: "fr",
  locale: "fr_FR",
  path: "/fr/",
  devPath: "/fr/developpeurs/",

  meta: {
    title: "AgentOS — Confiez votre ordinateur à un agent IA. Parlez-lui de n’importe où.",
    description:
      "Une app open source qui confie votre ordinateur à un agent IA, et vous laisse lui parler depuis votre téléphone ou vos écouteurs, aussi simplement qu’à une personne. Une première version pour le Mac, libre et gratuite.",
    cardAlt: "AgentOS : trois gouttes de lumière sur fond noir, et les mots « Give an AI agent your computer. Talk to it from anywhere. »",
    devTitle: "AgentOS pour les développeurs — Compilez-le, hébergez votre relais",
    devDescription:
      "Compilez AgentOS depuis les sources, voyez comment ses pièces s’assemblent, et joignez votre ordinateur de partout avec votre propre relais. Open source, MIT.",
  },

  nav: {
    label: "Sections",
    skip: "Aller au contenu",
    home: "AgentOS, accueil",
    links: [
      { href: "#feel", label: "À l’usage" },
      { href: "#charge", label: "Vous gardez la main" },
      { href: "#privacy", label: "Vie privée" },
    ],
    developers: "Pour les développeurs",
    language: "English",
    languageShort: "EN",
    github: "GitHub",
  },

  hero: {
    title: ["Confiez votre ordinateur à un agent IA.", "Parlez-lui de n’importe où."],
    lead:
      "AgentOS vit sur votre Mac et y fait le travail. Vous lui parlez depuis votre téléphone ou vos écouteurs, comme à une personne, et il vous demande avant les étapes risquées.",
    primary: "Obtenir AgentOS",
    secondary: "Le voir à l’œuvre",
    facts: "Une première version, pour le Mac. Libre et gratuit. Aucun compte AgentOS : Nova réfléchit avec une clé Claude que vous ajoutez une fois.",
    question: "Envoyer ce mail à Claire Martin ?",
    detail: "La facture de mars, 84,20 €, est jointe.",
  },

  request: {
    asking: "Nova vous demande",
    now: "à l’instant",
    go: "Allez-y",
    stop: "Stop",
    youSaid: "Vous avez dit « {answer} »",
    again: "Redemander",
    risk: "À regarder de près",
    details: "Détails",
    lookCloser: "Voir de plus près",
    close: "Fermer",
  },

  see: {
    title: "Quelqu’un devant votre ordinateur, même quand vous n’y êtes pas.",
    body:
      "AgentOS confie tout l’ordinateur à un agent IA : il voit l’écran, clique, tape et travaille sur vos fichiers. Vous lui demandez depuis votre téléphone, comme à une personne. Nova fait le travail, vous dit comment ça s’est passé, et s’arrête pour demander avant les étapes risquées.",
  },

  scene: {
    label: "Une courte scène sur un téléphone : Alex demande quelque chose à Nova, Nova travaille sur l’ordinateur resté à la maison, puis demande avant de mettre en production.",
    caption: "Alex est parti courir. Nova est à la maison, sur le Mac.",
    agent: "Nova",
    time: "7:42",
    live: "Écouteurs",
    placeholder: "Parler à Nova…",
    greeting: "Bonjour, Alex.",
    listening: "J’écoute.",
    ask: "Vous pouvez mettre les nouveaux prix sur le site ?",
    onIt: "Je m’en occupe. Je vous demande avant de mettre en ligne.",
    steps: ["Je mets les prix à jour", "Je lance les tests", "Je vérifie le site de test"],
    asking: "Nova vous demande",
    question: "Tout est bon.\nJe mets en production ?",
    answer: "Allez-y.",
    saidAloud: "Dit à voix haute",
    deploying: "C’est parti.",
    deployStep: "Je mets en production",
    done: "C’est fait, c’est en ligne.",
    stopped: "D’accord, j’attends. Tout est prêt.",
    go: "Allez-y",
    stop: "Stop",
    chapters: ["Vous demandez", "Nova travaille", "Nova demande", "Vous répondez"],
    play: "Lancer la scène",
    pause: "Mettre la scène en pause",
    replay: "Revoir la scène",
    chapter: "Aller à « {name} »",
    shot: {
      label: "Ce que voit Nova : le site de test, avec les 212 tests réussis.",
      url: "staging.orchard-bikes.example",
      brand: "Orchard Bikes",
      headline: "Prêts pour les beaux jours.",
      badge: "212 tests réussis",
      tiles: ["Ville", "Gravel", "Enfants"],
    },
  },

  feel: {
    title: "Comme confier son ordinateur à quelqu’un de confiance.",
    os: {
      title: "Donnez-lui l’écran.",
      body:
        "Votre écran devient sombre et calme. Il ne reste que Nova, et une ligne qui dit ce qu’il fait. Bougez la souris : vous reprenez la main quand vous voulez.",
      aside: "Vous préférez continuer à travailler ? Le panneau latéral garde Nova au bord de l’écran.",
      name: "Nova",
      line: "Je range les reçus du mois dernier",
      hint: "Reprendre la main",
      label: "Le mode OS : un écran sombre, et Nova au travail, qui range les reçus du mois dernier.",
    },
    watch: {
      title: "Répondez à voix haute.",
      body:
        "Avec vos écouteurs, Nova pose la question à voix haute et vous répondez simplement, le téléphone dans la poche. Une app compagnon pour Apple Watch est en cours, pour la même question au poignet.",
      note: "Par défaut, la voix passe par votre téléphone, sans clé.",
      progress: "En cours",
      question: "Envoyer le devis à Claire ?",
      label: "L’app compagnon pour Apple Watch, en cours : la question de Nova, avec Allez-y et Stop.",
    },
  },

  charge: {
    title: "Vous gardez la main.",
    lead:
      "Avant une étape qu’il sait risquée, comme payer, supprimer des fichiers ou publier, Nova s’arrête et demande, avec une image de ce qu’il voit. Arrêter tient toujours en un geste ou un mot.",
    try: "Essayez : les boutons marchent.",
    question: "Payer 240,00 € à Durand Plomberie ?",
    raw: "computer_click  ref e42\n# bouton « Confirmer le virement »\n# Safari, Banque Rivage",
    shot: {
      label: "Ce que voit Nova : le formulaire de virement de la banque, rempli, avant confirmation.",
      bank: "Banque Rivage",
      title: "Nouveau virement",
      amountLabel: "Montant",
      amount: "240,00 €",
      rows: [
        ["Bénéficiaire", "Durand Plomberie"],
        ["Référence", "Facture 2231"],
        ["Depuis", "Compte courant"],
      ],
      cancel: "Annuler",
      confirm: "Confirmer le virement",
    },
    autonomy: {
      title: "Que peut faire Nova sans demander ?",
      help: "Un réglage, trois positions. Vous pourrez changer d’avis à tout moment.",
      recommended: "Recommandé",
      options: [
        { value: "supervised", label: "Demander avant chaque changement", help: "Nova vous consulte avant de modifier quoi que ce soit sur votre ordinateur." },
        { value: "balanced", label: "Demander quand ça compte", help: "Nova travaille en autonomie, et demande avant les étapes risquées qu’il reconnaît." },
        { value: "autonomous", label: "Ne jamais s’arrêter pour demander", help: "Rien ne retient Nova, qui peut encore vous demander votre avis." },
      ],
    },
    caution: {
      lead: "Un agent qui peut utiliser tout votre ordinateur peut être trompé par ce qu’il lit.",
      body: "Une page web, un e-mail ou un fichier peut chercher à l’orienter. Demander d’abord réduit ce risque, sans le supprimer. Commencez par « Demander avant chaque changement », et assouplissez-le quand vous lui faites confiance.",
    },
  },

  privacy: {
    title: "Votre ordinateur, vos clés.",
    lead:
      "AgentOS n’a ni compte ni serveur à lui. Vos appareils parlent à votre ordinateur, et votre ordinateur ne parle qu’aux services que vous avez choisis : le modèle qui réfléchit, et une voix si vous en ajoutez une.",
    points: [
      {
        title: "Seuls les appareils que vous ajoutez.",
        body: "Un appareil n’entre qu’avec le code à usage unique affiché sur votre ordinateur. À la maison, la connexion est chiffrée avec le certificat propre à votre ordinateur, vérifié à chaque fois.",
      },
      {
        title: "Vos clés restent sur votre ordinateur.",
        body: "Les clés API sont rangées dans un fichier que vous seul pouvez lire, et ne sont jamais transmises, pas même à votre téléphone.",
      },
      {
        title: "Open source, licence MIT.",
        body: "Tout le code est sur GitHub. Lisez-le, modifiez-le, faites-le tourner vous-même.",
      },
    ],
  },

  today: {
    title: "Encore jeune, et on ne le cache pas.",
    lead:
      "AgentOS en est à la version 0.1. La boucle entière fonctionne — vous demandez, il travaille, il vous redemande, vous répondez — et il reste des angles à arrondir.",
    now: {
      title: "Ce qui marche aujourd’hui",
      items: [
        "L’app pour macOS",
        "L’app iPhone",
        "Le client web, dans n’importe quel navigateur",
        "Claude comme cerveau",
        "La voix du téléphone, ElevenLabs, ou votre propre serveur vocal",
        "Même réseau, Tailscale, ou votre propre relais",
        "En anglais et en français",
      ],
    },
    next: {
      title: "Ensuite",
      items: ["Une app compagnon pour Apple Watch, en cours", "Windows et Linux", "Android", "Le chiffrement de bout en bout via un relais"],
    },
    gallery: "Un enregistrement et de vrais écrans de la version 0.1 : le mode OS, le panneau latéral, et le client web sur un téléphone.",
    video: "Le mode OS, enregistré sur la version 0.1 : Nova lance les tests, demande avant de mettre en production, puis déploie.",
  },

  get: {
    title: "Confiez-lui un ordinateur. Puis allez courir.",
    body: "AgentOS est une première version, pour le Mac. Téléchargez l’app, ouvrez-la, et répondez à quelques questions. Elle est libre et gratuite.",
    primary: "Télécharger pour Mac",
    secondary: "Le compiler depuis les sources",
    key: "Nova réfléchit avec Claude : il vous faudra une clé Claude, ajoutée une fois. Vous l’obtenez chez Anthropic, qui facture ce que Nova utilise. AgentOS lui-même est gratuit.",
    setup: "Ensuite, quelques questions, votre clé Claude, et un code pour votre téléphone.",
    steps: [
      { caption: "Votre nom", question: "Comment vous appelez-vous ?", value: "Alex" },
      { caption: "Ce qu’il demande", question: "Que peut faire Nova sans demander ?", value: "" },
      { caption: "Son cerveau", question: "Donnez un cerveau à Nova", value: "" },
      { caption: "Votre téléphone", question: "Ajoutez votre téléphone", value: "Scannez ce code pour parler à Nova où que vous soyez." },
    ],
    qrLabel: "Un QR code. Celui-ci ouvre le dépôt AgentOS sur GitHub.",
  },

  developers: {
    title: "Construit au grand jour. Faites-le tourner vous-même.",
    lead:
      "AgentOS est petit, open source et sous licence MIT. Compilez-le depuis les sources, voyez comment ses pièces s’assemblent, et joignez votre ordinateur de partout avec votre propre relais.",
    jump: [
      { href: "#start", label: "Démarrage" },
      { href: "#how", label: "Comment ça marche" },
      { href: "#connect", label: "Auto-hébergement" },
    ],
    back: "Retour à AgentOS",
  },

  how: {
    title: "Trois pièces, toutes remplaçables.",
    lead:
      "AgentOS est petit, et c’est voulu. Le cœur tourne sur votre ordinateur et garde la conversation, les demandes et les règles de sécurité. Tout le reste vient s’y brancher.",
    you: { title: "Vous", body: "iPhone, écouteurs ou n’importe quel navigateur, et bientôt l’Apple Watch" },
    wire: "Un petit protocole, documenté",
    core: { title: "Votre ordinateur", body: "Le cœur d’AgentOS : conversations, demandes, règles de sécurité, fichiers simples." },
    parts: [
      {
        title: "Le cerveau",
        body: "Claude, via le Claude Agent SDK. Le moteur est une interface : d’autres modèles peuvent s’y brancher.",
        options: ["Claude"],
        open: "Votre modèle, même interface",
      },
      {
        title: "Les yeux et les mains",
        body: "L’arbre d’accessibilité de votre système, via agent-desktop, open source. Nova lit ce qui est à l’écran et agit dessus : boutons, champs, menus.",
        options: ["agent-desktop"],
        open: "",
      },
      {
        title: "Les oreilles et la voix",
        body: "La voix de votre téléphone par défaut, sans clé. Ajoutez une clé pour une voix premium comme ElevenLabs, ou branchez votre propre serveur vocal open source.",
        options: ["Votre téléphone", "ElevenLabs", "Votre serveur"],
        open: "",
      },
    ],
    clients: ["iPhone", "Écouteurs", "Navigateur"],
    soon: "Apple Watch, en cours",
  },

  connect: {
    title: "Joignez votre ordinateur de partout, à votre façon.",
    lead: "Votre téléphone et votre ordinateur se parlent directement. Des trois façons, choisissez celle qui vous va.",
    ways: [
      { title: "Sur le même réseau", body: "À la maison ou au bureau, votre téléphone trouve votre ordinateur tout seul, et la connexion est chiffrée avec le certificat propre à votre ordinateur." },
      { title: "De partout, avec Tailscale", body: "Installez Tailscale sur les deux. AgentOS le repère et met cette adresse dans le code d’association. Tailscale chiffre la connexion, et il n’y a aucun serveur à faire tourner." },
      {
        title: "De partout, avec votre relais",
        body: "Lancez un petit conteneur sur un serveur à vous. Il est privé : il n’accepte que les ordinateurs qui présentent son jeton. C’est votre ordinateur qui s’y connecte : rien à ouvrir sur votre réseau.",
      },
    ],
    relayLabel: "Votre relais.",
    relayBuild: "Pas encore d’image publiée : vous le construisez depuis votre clone. Une image viendra avec la première version.",
    relayNote: "Donnez ensuite à votre ordinateur l’adresse du relais et son jeton, dans Réglages › Avancé. Celui qui fait tourner un relais peut lire ce qui le traverse : faites tourner le vôtre. Le chiffrement de bout en bout entre téléphone et ordinateur est prévu.",
    computers: {
      title: "Plusieurs ordinateurs ?",
      body: "Associez-les un par un. Votre téléphone les montre ensemble, chacun avec son agent.",
      label: "Vos ordinateurs",
      rows: [
        { name: "Nova", where: "Mac du studio", line: "Je lance les tests", state: "working" },
        { name: "Iris", where: "MacBook Air", line: "Rien à faire", state: "idle" },
        { name: "Atlas", where: "Mac mini du bureau", line: "Votre ordinateur est injoignable", state: "offline" },
      ],
      jobs: "Avec chaque agent, une seule conversation, et dessous autant de tâches de fond qu’il lui en faut.",
    },
  },

  start: {
    title: "Lancez-le depuis les sources.",
    lead: "Vous préférez le compiler vous-même ? Il vous faut un Mac, Node.js 20.19 ou plus récent, et pnpm 10.",
    steps: [
      { label: "Récupérer le code et le compiler", code: "git clone https://github.com/Synapsr/AgentOS.git\ncd AgentOS\npnpm install\npnpm build" },
      { label: "Réveiller l’agent, sans clé pour l’instant", code: "AGENTOS_ENGINE=mock pnpm start", note: "Un cerveau d’entraînement : aucune clé, aucun coût, tout le reste est réel. Il affiche l’adresse où terminer la configuration." },
      { label: "Lui donner un vrai cerveau", code: "pnpm start", note: "Lance agentos start, le cœur seul. Collez une clé API Anthropic pendant la configuration, ou plus tard dans les Réglages." },
      { label: "Ajouter votre téléphone", code: "pnpm agentos pair", note: "Affiche un QR code à usage unique." },
    ],
    more: [
      { label: "Depuis un terminal", text: "pnpm agentos say \"…\"", note: "Et aussi status, pair et url." },
      { label: "L’app de bureau", text: "pnpm desktop", note: "Tauri 2 : il vous faut Rust." },
      { label: "L’app iPhone", text: "cd apps/ios && xcodegen", note: "Puis ouvrez le projet dans Xcode." },
    ],
    copy: "Copier",
    copied: "Copié",
    files: {
      title: "Tout tient dans des fichiers simples.",
      body: "Pas de base de données. Ce que sait Nova vit dans ~/.agentos, lisible avec n’importe quel éditeur.",
      tree: [
        ["config.json", "qui est l’agent, ce qu’il demande"],
        ["secrets.json", "les clés API, lisibles par vous seul"],
        ["devices.json", "les appareils associés, en empreintes"],
        ["events.jsonl", "tout ce qui s’est passé"],
        ["threads/", "un fichier par conversation"],
        ["files/", "captures d’écran et autres fichiers"],
      ],
    },
    protocol: {
      title: "Un petit protocole.",
      body: "HTTP et WebSocket, en JSON, défini dans packages/protocol. Tous les clients le parlent : les apps, le client web, vos scripts.",
    },
    links: [
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/ARCHITECTURE.md", label: "Architecture" },
      { href: "https://github.com/Synapsr/AgentOS/tree/main/packages/protocol", label: "Le protocole" },
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/DESIGN.md", label: "Le design" },
    ],
  },

  footer: {
    tagline: "Confiez votre ordinateur à un agent IA. Parlez-lui de n’importe où.",
    license: "Open source, sous licence MIT.",
    links: [
      { href: "https://github.com/Synapsr/AgentOS", label: "GitHub" },
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/ARCHITECTURE.md", label: "Architecture" },
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/DESIGN.md", label: "Design" },
      { href: "https://github.com/Synapsr/AgentOS/blob/main/docs/PRESENCE.md", label: "La présence" },
    ],
  },
};
