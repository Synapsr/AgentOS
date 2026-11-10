#if DEBUG
import SwiftUI

/// A made-up computer, for screenshots and for trying the app without one,
/// like the interface's `?demo`. Launch a debug build with `-demo <scene>`:
///
///     xcrun simctl launch booted org.agentos.app -demo request
///
/// | Scene | On screen |
/// |---|---|
/// | `home` | Nova at rest, with a finished job (no work in the background) |
/// | `working` | Nova at work on a website |
/// | `request` | A high-risk payment, with what Nova sees |
/// | `question` | A question with Nova's own options and a picture |
/// | `approval` | A medium-risk approval, with its command behind Details |
/// | `answered`, `stopped` | The payment, answered on this phone two seconds in: Go ahead, or Stop |
/// | `conversation`, `history`, `empty` | The conversation: a request waiting in it, what was answered, or nothing yet |
/// | `computers` | The list of computers |
/// | `offline` | The computer out of reach |
/// | `pairing`, `pairing-confirm` | Adding a computer |
/// | `notification` | The payment again as a notification, 5 s in: put the app in the background |
///
/// The words follow the phone's language, English or French. Nothing in it
/// is anybody's real computer, and nothing leaves the phone.
@MainActor
enum Demo {
    /// The scene asked for at launch, if any.
    static let scene: String? = {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-demo"), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }()

    private static let isFrench = Locale.preferredLanguages.first?.hasPrefix("fr") == true

    private static func say(_ english: String, _ french: String) -> String {
        isFrench ? french : english
    }

    // MARK: The computers

    static func stores(for scene: String) -> [ComputerStore] {
        guard !scene.hasPrefix("pairing") else { return [] }
        let script = Script()
        let studio = ComputerStore(demo: computer("node_studio", "Studio Mac", agent: "Nova"), state: state(for: scene), pictures: pictures, script: script)
        if scene == "offline" { studio.goOffline() }
        if scene == "answered" || scene == "stopped" {
            Task {
                try? await Task.sleep(for: .seconds(2.5))
                let option = scene == "stopped" ? RequestItem.Option.deny : RequestItem.Option.approve
                await script.resolve("req_pay", optionId: option, text: nil, on: studio)
            }
        }
        guard scene == "computers" else { return [studio] }
        let laptop = ComputerStore(demo: computer("node_laptop", "MacBook Air", agent: "Iris"), state: ComputerState(), pictures: [:], script: script)
        laptop.goOffline()
        return [studio, laptop]
    }

    /// Adding a computer, for the pairing scenes.
    static func pairing(for scene: String) -> AppModel.Pairing? {
        guard scene == "pairing-confirm" else { return nil }
        return PairingLink("agentos://pair?v=1&c=demo&i=node_studio&n=Studio%20Mac&u=https://192.168.1.20:4747&u=https://studio.tail1234.ts.net")
            .map { .confirming($0) }
    }

    /// Requests the scene sets aside, so that what is behind them shows.
    static func setAside(for scene: String) -> Set<String> {
        scene == "conversation" ? ["req_pay"] : []
    }

    private static func computer(_ id: String, _ name: String, agent: String) -> Computer {
        Computer(
            id: id, name: name, agentName: agent, urls: [URL(string: "https://192.168.1.20:4747")!], fingerprint: nil,
            lastURL: nil, deviceId: "dev_phone", token: "demo", addedAt: .now)
    }

    private static func state(for scene: String) -> ComputerState {
        var state = ComputerState()
        let now = Date.now
        func ago(_ minutes: Double) -> Date { now.addingTimeInterval(-minutes * 60) }
        state.node = NodeInfo(
            id: "node_studio", name: "Studio Mac", platform: .macos, version: "0.1.0", protocol: 1,
            agent: .init(name: "Nova"), owner: .init(name: "Alex"), language: isFrench ? "fr" : "en", autonomy: .balanced, onboarded: true,
            capabilities: .init(computer: true, engine: "claude", engineReady: true, voice: .init(provider: "apple", stt: .device, tts: .device, ttsMime: nil)))
        state.threads[mainThread] = thread(mainThread, .main, "Nova", .idle, nil, ago(600))
        state.threads["thr_photos"] = thread("thr_photos", .job, say("Holiday photos", "Photos de vacances"), .idle, say("2,418 photos sorted", "2 418 photos classées"), ago(150))
        if scene != "home" {
            state.threads["thr_backup"] = thread("thr_backup", .job, say("Weekly backup", "Sauvegarde de la semaine"), .working, say("Comparing with last week", "Comparaison avec la semaine dernière"), ago(2))
        }
        var items: [Item] = []
        var status = NodeStatus(state: .idle, activity: nil, mode: .desktop, pendingRequests: 0, workingThreads: scene == "home" ? 0 : 1)
        if scene != "home", scene != "empty" {
            items += history(ago)
        }
        switch scene {
        case "working", "question":
            items.append(message("m_launch", .user, say("The website needs the new prices before Friday's launch. Can you take care of it?", "Le site doit afficher les nouveaux prix avant le lancement de vendredi. Vous pouvez vous en occuper ?"), ago(6)))
            items.append(message("m_onit", .agent, say("On it. I'll update the page, run the checks, and ask you before anything goes live.", "Je m'en occupe. Je mets la page à jour, je lance les vérifications, et je vous demande avant toute mise en ligne."), ago(6)))
            items.append(activity("a_open", say("Opening the project", "Ouverture du projet"), ago(5), done: true))
            items.append(activity("a_prices", say("Updating the pricing page", "Mise à jour de la page des prix"), ago(4), done: true))
            items.append(activity("a_tests", say("Running the tests", "Lancement des tests"), ago(3), done: scene == "question", detail: "npm test"))
            state.threads[mainThread] = thread(mainThread, .main, "Nova", .working, nil, ago(3))
            status = NodeStatus(state: .working, activity: say("Running the tests", "Lancement des tests"), mode: .desktop, pendingRequests: 0, workingThreads: 2)
            if scene == "question" { items.append(.request(deploy(ago(0.5)))) }
        case "request", "answered", "stopped", "conversation", "notification":
            items.append(message("m_pay", .user, say("The plumber's invoice is in my inbox. Can you pay it?", "La facture du plombier est dans ma boîte mail. Vous pouvez la payer ?"), ago(3), via: .voice))
            items.append(activity("a_invoice", say("Opening the invoice", "Ouverture de la facture"), ago(2.5), done: true))
            items.append(activity("a_bank", say("Signing in to the bank", "Connexion à la banque"), ago(2), done: true))
            items.append(activity("a_fill", say("Filling in the transfer", "Saisie du virement"), ago(1), done: true))
            items.append(.request(payment(ago(0.5))))
        case "approval":
            items.append(message("m_mail", .user, say("Can you send the bill to my accountant?", "Vous pouvez envoyer la facture à ma comptable ?"), ago(2)))
            items.append(.request(email(ago(0.5))))
        default:
            break
        }
        for item in items { state.upsert(item) }
        if !state.pending.isEmpty {
            status = NodeStatus(state: .waiting, activity: nil, mode: .desktop, pendingRequests: state.pending.count, workingThreads: 1)
        }
        state.status = status
        state.hasEarlier = [mainThread: false, "thr_photos": false, "thr_backup": false]
        return state
    }

    /// What happened earlier today: an email sent with the owner's yes.
    private static func history(_ ago: (Double) -> Date) -> [Item] {
        let sent = email(ago(93)).answered(RequestItem.Option.approve, at: ago(92))
        let kept = RequestItem(
            id: "req_delete", threadId: mainThread, at: ago(130), kind: .approval,
            title: say("Delete 214 files in Downloads?", "Supprimer 214 fichiers dans Téléchargements ?"), body: "rm -r ~/Downloads/old",
            spoken: say("I'd like to delete 214 old files in Downloads. Can I go ahead?", "Je voudrais supprimer 214 vieux fichiers dans Téléchargements. Je peux y aller ?"),
            risk: .high, screenshot: nil, options: approveOrStop, allowText: false, state: .pending, resolution: nil
        ).answered(RequestItem.Option.deny, at: ago(129))
        return [
            message("m_tidy", .user, say("Can you tidy my Downloads folder?", "Vous pouvez ranger mon dossier Téléchargements ?"), ago(131)),
            .request(kept),
            message("m_kept", .agent, say("Understood. I've left them where they are.", "Compris. Je les laisse où ils sont."), ago(129)),
            message("m_bill", .user, say("Can you find last month's electricity bill and send it to my accountant?", "Vous pouvez retrouver la facture d'électricité du mois dernier et l'envoyer à ma comptable ?"), ago(95), via: .voice),
            activity("a_mail", say("Searching Mail", "Recherche dans Mail"), ago(95), done: true),
            activity("a_bill", say("Opening the bill", "Ouverture de la facture"), ago(94), done: true),
            activity("a_write", say("Writing to Claire Martin", "Rédaction du message à Claire Martin"), ago(94), done: true),
            message("m_found", .agent, say("Found it: **March, €84.20**. The email to Claire is ready, with the bill attached.", "Je l'ai : **mars, 84,20 €**. Le message pour Claire est prêt, avec la facture en pièce jointe."), ago(93)),
            .request(sent),
            message("m_sent", .agent, say("Sent. I also filed the bill in Documents › Bills.", "Envoyé. J'ai aussi rangé la facture dans Documents › Factures."), ago(92)),
        ]
    }

    // MARK: The requests

    private static let approveOrStop = [
        RequestItem.Option(id: RequestItem.Option.approve, label: say("Go ahead", "Allez-y"), style: .primary),
        RequestItem.Option(id: RequestItem.Option.deny, label: "Stop", style: .danger),
    ]

    private static func payment(_ at: Date) -> RequestItem {
        RequestItem(
            id: "req_pay", threadId: mainThread, at: at, kind: .approval,
            title: say("Pay €240.00 to Durand Plomberie?", "Payer 240,00 € à Durand Plomberie ?"),
            body: "bank.transfer({ to: \"Durand Plomberie\", iban: \"FR76 3000 4000 0312 3456 7890 143\", amount: \"240.00 EUR\", reference: \"Invoice 2231\" })",
            spoken: say("I'd like to pay €240 to Durand Plomberie. Can I go ahead?", "Je voudrais payer 240 € à Durand Plomberie. Je peux y aller ?"),
            risk: .high, screenshot: FileRef(id: "shot_bank", mime: "image/png", width: 1280, height: 800),
            options: approveOrStop, allowText: false, state: .pending, resolution: nil)
    }

    private static func email(_ at: Date) -> RequestItem {
        RequestItem(
            id: "req_email", threadId: mainThread, at: at, kind: .approval,
            title: say("Send this email to Claire Martin?", "Envoyer ce message à Claire Martin ?"),
            body: "mail.send --to claire.martin@cabinet-martin.fr --subject \"" + say("Electricity, March", "Électricité, mars") + "\" --attach ~/Documents/Bills/edf-2026-03.pdf",
            spoken: say("The email to Claire is ready. Can I send it?", "Le message pour Claire est prêt. Je peux l'envoyer ?"),
            risk: .medium, screenshot: nil, options: approveOrStop, allowText: false, state: .pending, resolution: nil)
    }

    private static func deploy(_ at: Date) -> RequestItem {
        RequestItem(
            id: "req_deploy", threadId: mainThread, at: at, kind: .question,
            title: say("Everything looks good. Deploy to production?", "Tout est prêt. Je mets en production ?"),
            body: say("The new prices are on the page and all 48 tests pass.", "Les nouveaux prix sont sur la page et les 48 tests passent."),
            spoken: say("Everything looks good. Shall I deploy to production?", "Tout est prêt. Je mets en production ?"),
            risk: .medium, screenshot: FileRef(id: "shot_site", mime: "image/png", width: 1280, height: 800),
            options: [
                .init(id: "deploy", label: say("Deploy", "Mettre en ligne"), style: .primary),
                .init(id: "later", label: say("Not yet", "Pas encore"), style: .default),
            ],
            allowText: true, state: .pending, resolution: nil)
    }

    // MARK: Pieces

    private static func thread(_ id: String, _ kind: ThreadInfo.Kind, _ title: String, _ state: ThreadInfo.State, _ preview: String?, _ at: Date) -> ThreadInfo {
        ThreadInfo(id: id, kind: kind, title: title, parentId: nil, cwd: nil, state: state, preview: preview, createdAt: at, updatedAt: at)
    }

    private static func message(_ id: String, _ role: MessageItem.Role, _ text: String, _ at: Date, via: Via = .text) -> Item {
        .message(MessageItem(id: id, threadId: mainThread, at: at, role: role, text: text, via: via, deviceId: role == .user ? "dev_phone" : nil, files: []))
    }

    private static func activity(_ id: String, _ label: String, _ at: Date, done: Bool, detail: String? = nil) -> Item {
        .activity(ActivityItem(id: id, threadId: mainThread, at: at, label: label, tool: nil, detail: detail, state: done ? .done : .running, endedAt: done ? at : nil))
    }

    // MARK: What Nova sees

    private static let pictures: [String: Data] = [
        "shot_bank": picture(BankWindow()),
        "shot_site": picture(SiteWindow()),
    ].compactMapValues(\.self)

    private static func picture(_ view: some View) -> Data? {
        let renderer = ImageRenderer(content: view.frame(width: 640, height: 400).environment(\.colorScheme, .light))
        renderer.scale = 2
        return renderer.uiImage?.pngData()
    }

    /// A stand-in for a bank's website, as Nova would see it.
    private struct BankWindow: View {
        var body: some View {
            Window(title: "Banque Rivage") {
                VStack(alignment: .leading, spacing: 10) {
                    Text(say("New transfer", "Nouveau virement")).font(.system(size: 17, weight: .semibold))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(say("Amount", "Montant")).font(.system(size: 11)).foregroundStyle(.secondary)
                        Text(say("€240.00", "240,00 €")).font(.system(size: 30, weight: .regular))
                    }
                    ForEach([
                        (say("To", "À"), "Durand Plomberie"),
                        (say("Reference", "Référence"), say("Invoice 2231", "Facture 2231")),
                        (say("From", "Depuis"), say("Current account", "Compte courant")),
                    ], id: \.0) { row in
                        Divider()
                        HStack {
                            Text(row.0).foregroundStyle(.secondary)
                            Spacer()
                            Text(row.1)
                        }
                        .font(.system(size: 12))
                    }
                    Spacer()
                    HStack(spacing: 10) {
                        Spacer()
                        Text(say("Cancel", "Annuler")).padding(.horizontal, 22).padding(.vertical, 8).background(Color(white: 0.92), in: .rect(cornerRadius: 6))
                        Text(say("Confirm transfer", "Confirmer le virement")).foregroundStyle(.white).padding(.horizontal, 18).padding(.vertical, 8).background(Color(red: 0.15, green: 0.4, blue: 0.95), in: .rect(cornerRadius: 6))
                    }
                    .font(.system(size: 12, weight: .medium))
                }
            }
        }
    }

    /// A stand-in for the owner's website, with its new prices.
    private struct SiteWindow: View {
        var body: some View {
            Window(title: "atelier-lumen.com") {
                VStack(alignment: .leading, spacing: 14) {
                    Text(say("Atelier Lumen", "Atelier Lumen")).font(.system(size: 20, weight: .semibold, design: .serif))
                    Text(say("New prices from Friday", "Nouveaux prix dès vendredi")).font(.system(size: 13)).foregroundStyle(.secondary)
                    HStack(spacing: 10) {
                        ForEach([("Atelier", "€29"), ("Studio", "€59"), ("Maison", "€119")], id: \.0) { plan in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(plan.0).font(.system(size: 12, weight: .medium))
                                Text(plan.1).font(.system(size: 24, weight: .semibold))
                                Text(say("a month", "par mois")).font(.system(size: 10)).foregroundStyle(.secondary)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(white: 0.95), in: .rect(cornerRadius: 8))
                        }
                    }
                    Spacer()
                }
            }
        }
    }

    /// A desktop window on a soft backdrop.
    private struct Window<Content: View>: View {
        let title: String
        @ViewBuilder var content: Content

        var body: some View {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    ForEach([Color.red, .yellow, .green], id: \.self) { Circle().fill($0.opacity(0.8)).frame(width: 9, height: 9) }
                    Spacer()
                    Text(title).font(.system(size: 11)).foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 12)
                .frame(height: 28)
                .background(Color(white: 0.93))
                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach([0.7, 0.5, 0.8, 0.4], id: \.self) { width in
                            Capsule().fill(Color(white: width == 0.5 ? 0.25 : 0.85)).frame(width: 90 * width, height: 5)
                        }
                        Spacer()
                    }
                    .padding(16)
                    .frame(width: 120)
                    .background(Color(white: 0.96))
                    content
                        .padding(20)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .background(Color.white)
                }
            }
            .foregroundStyle(Color(white: 0.1))
            .clipShape(.rect(cornerRadius: 10))
            .padding(.horizontal, 48)
            .padding(.top, 28)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(LinearGradient(colors: [Color(red: 0.24, green: 0.29, blue: 0.45), Color(red: 0.45, green: 0.3, blue: 0.42)], startPoint: .topLeading, endPoint: .bottomTrailing))
        }
    }

    // MARK: What the made-up computer does

    /// Moves things along as a computer would, once answered or talked to.
    @MainActor
    final class Script {
        func resolve(_ requestId: String, optionId: String?, text: String?, on store: ComputerStore) async {
            try? await Task.sleep(for: .milliseconds(600))
            guard let request = store.state.pending.first(where: { $0.id == requestId }) else { return }
            let said = optionId ?? "words"
            store.play { $0.upsert(.request(request.answered(optionId, text: text, at: .now))) }
            let yes = said == RequestItem.Option.approve || said == "deploy"
            guard yes else {
                // The backup carries on; the agent takes a moment to say it stopped, and its line says it heard meanwhile.
                store.play { $0.status = NodeStatus(state: .working, activity: nil, mode: .desktop, pendingRequests: 0, workingThreads: 1) }
                try? await Task.sleep(for: .seconds(5))
                say(Demo.say("Understood. I've left the transfer unsent.", "Compris. Je n'ai pas envoyé le virement."), on: store)
                return
            }
            let working = Demo.say("Confirming the transfer", "Confirmation du virement")
            store.play {
                $0.upsert(Demo.activity("a_confirm", working, .now, done: false))
                $0.status = NodeStatus(state: .working, activity: working, mode: .desktop, pendingRequests: 0, workingThreads: 1)
            }
            try? await Task.sleep(for: .seconds(2.4))
            store.play { $0.upsert(Demo.activity("a_confirm", working, .now, done: true)) }
            say(Demo.say("Paid. The receipt is in Documents › Invoices.", "Payé. Le reçu est dans Documents › Factures."), on: store)
        }

        func send(_ text: String, via: Via, to threadId: String, on store: ComputerStore) async -> RequestItem? {
            store.play { $0.upsert(Demo.message("m_\(UUID().uuidString)", .user, text, .now, via: via)) }
            try? await Task.sleep(for: .seconds(1.2))
            say(Demo.say("This is a demo, so I can't really do that. On your own computer, I'd already be on it.", "Ceci est une démonstration, je ne peux donc pas vraiment le faire. Sur votre ordinateur, je serais déjà au travail."), on: store)
            return nil
        }

        private func say(_ text: String, on store: ComputerStore) {
            store.play {
                $0.upsert(Demo.message("m_\(UUID().uuidString)", .agent, text, .now))
                $0.status = NodeStatus(state: .idle, activity: nil, mode: .desktop, pendingRequests: 0, workingThreads: 1)
            }
        }
    }
}

private extension RequestItem {
    /// The same request, answered on this phone.
    func answered(_ optionId: String?, text: String? = nil, at: Date) -> RequestItem {
        RequestItem(
            id: id, threadId: threadId, at: self.at, kind: kind, title: title, body: body, spoken: spoken, risk: risk,
            screenshot: screenshot, options: options, allowText: allowText, state: .resolved,
            resolution: .init(optionId: optionId, text: text, deviceId: "dev_phone", at: at))
    }
}
#endif
