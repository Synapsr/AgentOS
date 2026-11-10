import AVFAudio
import Observation

/// The app's voice: it listens and talks for whichever computer it is asked
/// to, with the engines that computer wants, and publishes what the orb
/// needs to show.
@MainActor @Observable
final class Voice {
    enum Activity {
        case idle, listening, speaking
    }

    private(set) var activity = Activity.idle
    /// What has been heard so far, when the engine recognises as it goes.
    private(set) var heard = ""
    /// What is being said.
    private(set) var saying = ""

    /// True while Live mode holds the audio session and the microphone open.
    @ObservationIgnored var isLive = false
    @ObservationIgnored let microphone = Microphone()

    @ObservationIgnored private var ears: (any VoiceEngine)?
    @ObservationIgnored private var mouth: (any VoiceEngine)?
    @ObservationIgnored private var starting: Task<Void, any Error>?
    @ObservationIgnored private var deviceVoices: [String: DeviceVoice] = [:]
    @ObservationIgnored private var hearing: Task<Void, Never>?

    /// Loudness right now, 0–1: the owner's voice while listening, the
    /// agent's while speaking. Not observed — the presence asks for it at
    /// every frame.
    var level: Double {
        mouth?.outputLevel ?? (ears == nil ? 0 : microphone.level)
    }

    // MARK: Hearing

    /// Starts hearing the owner, in the language of `store`'s agent.
    func startListening(for store: ComputerStore) async throws {
        guard ears == nil, starting == nil else { return }
        let start = Task {
            guard await AVAudioApplication.requestRecordPermission() else { throw VoiceError.microphoneDenied }
            stopSpeaking()
            if !isLive {
                try AudioSession.beginRecording()
                try microphone.start()
            }
            let engine = engine(for: store, side: \.stt)
            ears = engine
            refresh()
            try await engine.startListening()
        }
        starting = start
        defer { starting = nil }
        do {
            try await start.value
        } catch {
            _ = try? await finish()
            throw error
        }
    }

    /// Stops hearing and returns what was said.
    func stopListening() async throws -> String {
        // A release that comes before listening has fully started waits for it.
        _ = await starting?.result
        guard ears != nil else { return "" }
        return try await finish()
    }

    /// Waits for the owner to answer: up to `patience` for a first word,
    /// then until they have been quiet for a moment. Returns what they said.
    func awaitReply(patience: Duration = .seconds(8)) async -> String {
        let clock = ContinuousClock()
        let start = clock.now
        var lastHeard = heard
        var lastVoice: ContinuousClock.Instant? = heard.isEmpty ? nil : start
        while ears != nil, !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(100))
            // Words when the phone recognises as it goes; loudness otherwise.
            let isTalking = ears?.partial == nil ? level > Microphone.voice : heard != lastHeard
            lastHeard = heard
            if isTalking { lastVoice = clock.now }
            if let lastVoice {
                if clock.now - lastVoice > .milliseconds(1400) || clock.now - start > .seconds(45) { break }
            } else if clock.now - start > patience {
                break
            }
        }
        return (try? await stopListening()) ?? ""
    }

    private func finish() async throws -> String {
        defer {
            ears = nil
            if !isLive {
                microphone.stop()
                AudioSession.end()
            }
            refresh()
        }
        return try await ears?.finishListening() ?? ""
    }

    // MARK: Talking

    /// Says `text` in the voice of `store`'s agent. Returns when it has been
    /// said, or stopped.
    func speak(_ text: String, for store: ComputerStore) async {
        // Outside Live mode, never talk over the owner.
        guard isLive || ears == nil else { return }
        stopSpeaking()
        let engine = engine(for: store, side: \.tts)
        (engine as? DeviceVoice)?.usesOwnSession = isLive
        if !isLive { try? AudioSession.beginSpeaking() }
        mouth = engine
        saying = text
        refresh()
        await engine.speak(text)
        // Unless something else took over meanwhile, give the audio back.
        guard mouth === engine else { return }
        mouth = nil
        saying = ""
        if !isLive { AudioSession.end() }
        refresh()
    }

    func stopSpeaking() {
        guard let mouth else { return }
        self.mouth = nil
        saying = ""
        mouth.stopSpeaking()
        refresh()
    }

    // MARK: Plumbing

    /// The engine the computer asks for on one side: its own, or this phone's.
    private func engine(for store: ComputerStore, side: KeyPath<VoiceCapabilities, VoiceSide>) -> any VoiceEngine {
        let node = store.state.node
        let language = node?.language ?? Locale.current.language.languageCode?.identifier ?? "en"
        if let voice = node?.capabilities.voice, voice[keyPath: side] == .server {
            return ServerVoice(client: store.api, language: language, ttsMime: voice.ttsMime, microphone: microphone)
        }
        if let existing = deviceVoices[language] { return existing }
        let engine = DeviceVoice(language: language, microphone: microphone)
        deviceVoices[language] = engine
        return engine
    }

    /// Recomputes `activity` and, while listening, follows what is heard.
    private func refresh() {
        activity = mouth != nil ? .speaking : ears != nil ? .listening : .idle
        guard ears != nil else {
            hearing?.cancel()
            hearing = nil
            heard = ""
            return
        }
        guard hearing == nil else { return }
        hearing = Task {
            while !Task.isCancelled {
                let partial = ears?.partial ?? ""
                if partial != heard { heard = partial }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
    }
}
