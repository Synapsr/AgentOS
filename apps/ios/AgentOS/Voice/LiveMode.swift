import AVFAudio
import Observation

/// Live mode: the agent in the owner's ears while the phone is in a pocket.
///
/// Started by a tap, it keeps the microphone and the event connection alive
/// in the background. When the agent finishes or asks, the phone says it
/// over the music, listens a few seconds for a spoken answer and sends it.
@MainActor @Observable
final class LiveMode {
    enum State {
        case off, on
        /// Still running, but silent: the earbuds came out, or a call took
        /// the audio. Notifications carry on meanwhile.
        case paused
    }

    private(set) var state = State.off

    /// Called when Live mode stops being able to talk without the owner
    /// having asked for it, so that they can be told another way.
    @ObservationIgnored var onTrouble: () -> Void = {}

    private let voice: Voice
    /// A computer does the talking itself, with its own voice.
    private var computerTalks = false
    private var queue: AsyncStream<Announcement>.Continuation?
    private var tasks: [Task<Void, Never>] = []

    private struct Announcement {
        let text: String
        let threadId: String
        /// The request this is the question of, if it is one.
        let requestId: String?
        let store: ComputerStore
    }

    init(voice: Voice) {
        self.voice = voice
    }

    /// Starts Live mode. iOS only allows this while the app is on screen.
    /// - Parameter computerTalks: one of the computers speaks with its own voice rather than the phone's.
    func start(computerTalks: Bool) async throws {
        guard state == .off else { return }
        guard await AVAudioApplication.requestRecordPermission() else { throw VoiceError.microphoneDenied }
        self.computerTalks = computerTalks
        try open()
        voice.isLive = true
        state = .on

        let (announcements, queue) = AsyncStream<Announcement>.makeStream()
        self.queue = queue
        let center = NotificationCenter.default
        tasks = [
            Task { for await announcement in announcements { await converse(announcement) } },
            Task { for await note in center.notifications(named: AVAudioSession.interruptionNotification) { interrupted(note) } },
            Task { for await note in center.notifications(named: AVAudioSession.routeChangeNotification) { routeChanged(note) } },
            // The engine stops itself whenever the route changes format.
            Task { for await _ in center.notifications(named: .AVAudioEngineConfigurationChange) { restartMicrophone() } },
        ]
    }

    func stop() {
        guard state != .off else { return }
        tasks.forEach { $0.cancel() }
        tasks = []
        queue = nil
        state = .off
        voice.stopSpeaking()
        voice.isLive = false
        Task {
            _ = try? await voice.stopListening()
            voice.microphone.stop()
            AudioSession.end()
        }
    }

    /// Talks again after a pause.
    func resume() {
        guard state == .paused else { return }
        do {
            try open()
            state = .on
        } catch {
            onTrouble()
        }
    }

    /// Says `text` when its turn comes, then listens for an answer and
    /// sends it to the conversation `threadId` of `store`. When `text` is
    /// the question of a request, what is heard next is sent as the reply
    /// to that request — and to nothing else. Returns false when Live mode
    /// is not talking right now.
    @discardableResult
    func announce(_ text: String, replyTo threadId: String, answering requestId: String? = nil, on store: ComputerStore) -> Bool {
        guard state == .on, let queue else { return false }
        queue.yield(Announcement(text: text, threadId: threadId, requestId: requestId, store: store))
        return true
    }

    private func open() throws {
        try AudioSession.beginLive()
        // The phone's voice quiets the music by itself; a computer's needs help.
        if computerTalks { try voice.microphone.quietOtherAudioWhileVoicesTalk() }
        try voice.microphone.start()
    }

    private func converse(_ announcement: Announcement) async {
        guard state == .on else { return }
        let store = announcement.store
        // With earbuds in, the phone does not hear itself: it can listen
        // while it talks, and stop talking as soon as the owner does.
        let canCutIn = AudioSession.isPrivate && store.state.node?.capabilities.voice.stt != .server
        if canCutIn { try? await voice.startListening(for: store) }
        let cutIn = Task {
            while !Task.isCancelled {
                if !voice.heard.isEmpty { return voice.stopSpeaking() }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        await voice.speak(announcement.text, for: store)
        cutIn.cancel()

        if !canCutIn, state == .on { try? await voice.startListening(for: store) }
        let reply = await voice.awaitReply()
        guard !reply.isEmpty else { return }
        // A request answered elsewhere meanwhile refuses the words (409):
        // a reply to a question that is gone means nothing on its own.
        let request = try? await store.send(reply, via: .voice, to: announcement.threadId, answering: announcement.requestId)
        // Not a clear yes or no: say so once and leave it waiting — it can
        // still be answered on the phone, the watch or the computer.
        if request?.state == .pending, state == .on {
            let language = Locale(identifier: store.state.node?.language ?? Locale.current.identifier)
            await voice.speak(String(localized: .init("I didn't catch a clear answer. It's still waiting for you.", locale: language)), for: store)
        }
    }

    private func pause() {
        guard state == .on else { return }
        state = .paused
        voice.stopSpeaking()
    }

    private func interrupted(_ note: Notification) {
        let info = note.userInfo ?? [:]
        switch (info[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init) {
        case .began:
            pause()
        case .ended:
            let options = AVAudioSession.InterruptionOptions(rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            if options.contains(.shouldResume) { resume() } else { onTrouble() }
        default:
            break
        }
    }

    private func routeChanged(_ note: Notification) {
        let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init)
        switch reason {
        case .oldDeviceUnavailable:
            // Earbuds out: do not start talking to the whole room.
            if !AudioSession.isPrivate { pause() }
        case .newDeviceAvailable:
            if AudioSession.isPrivate { resume() }
        default:
            break
        }
    }

    private func restartMicrophone() {
        guard state != .off else { return }
        do {
            try voice.microphone.start()
        } catch {
            pause()
            onTrouble()
        }
    }
}
