import AVFAudio
import Speech

/// Speech done by the phone itself — the default, with nothing to set up:
/// `SpeechAnalyzer` to hear, `AVSpeechSynthesizer` to talk. No audio ever
/// leaves the device.
@MainActor
final class DeviceVoice: NSObject, VoiceEngine {
    private let locale: Locale
    private let microphone: Microphone

    private var analyzer: SpeechAnalyzer?
    private var feed: AsyncStream<AnalyzerInput>.Continuation?
    private var results: Task<Void, Never>?
    private var finalized = ""
    private var volatile = ""

    private let synthesizer = AVSpeechSynthesizer()
    private lazy var voice = Self.bestVoice(for: locale)
    private var speaking: (utterance: ObjectIdentifier, done: CheckedContinuation<Void, Never>)?
    private var lastWord = ContinuousClock.now - .seconds(60)

    /// When true the synthesizer plays through a session of its own, which
    /// iOS mixes with — and ducks — other audio without touching the app's
    /// session. Live mode needs that: its session must stay as it is.
    var usesOwnSession = false {
        didSet { synthesizer.usesApplicationAudioSession = !usesOwnSession }
    }

    /// - Parameter language: BCP‑47 language the agent speaks, e.g. "fr".
    init(language: String, microphone: Microphone) {
        // "en" says nothing of the accent: when the phone is set to the
        // same language, its region is the owner's.
        let agent = Locale(identifier: language)
        let phone = Locale.current
        let sameLanguage = agent.language.languageCode == phone.language.languageCode
        self.locale = agent.language.region == nil && sameLanguage ? phone : agent
        self.microphone = microphone
        super.init()
        synthesizer.delegate = self
    }

    // MARK: Hearing

    var partial: String? { finalized + volatile }

    func startListening() async throws {
        finalized = ""
        volatile = ""
        let (module, follow) = try await transcriber()
        if let download = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
            try await download.downloadAndInstall()
        }
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]),
              let converter = AVAudioConverter(from: microphone.format, to: format) else {
            throw VoiceError.unsupportedLanguage
        }
        let (inputs, feed) = AsyncStream<AnalyzerInput>.makeStream()
        // Capture before the analyzer is up, so the first word is not lost.
        microphone.sink = { buffer in
            if let converted = Self.convert(buffer, with: converter) { feed.yield(AnalyzerInput(buffer: converted)) }
        }
        let analyzer = SpeechAnalyzer(modules: [module], options: .init(priority: .userInitiated, modelRetention: .lingering))
        self.analyzer = analyzer
        self.feed = feed
        self.results = follow()
        try await analyzer.start(inputSequence: inputs)
    }

    func finishListening() async throws -> String {
        microphone.sink = nil
        feed?.finish()
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        await results?.value
        analyzer = nil
        feed = nil
        results = nil
        return (finalized + volatile).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The best recogniser this phone has for the language — the iOS 26
    /// transcriber, or the dictation one on phones that cannot run it — and
    /// the way to start following what it hears.
    private func transcriber() async throws -> (any SpeechModule, follow: () -> Task<Void, Never>) {
        if SpeechTranscriber.isAvailable, let match = await SpeechTranscriber.supportedLocale(equivalentTo: locale) {
            let module = SpeechTranscriber(locale: match, preset: .progressiveTranscription)
            if await AssetInventory.status(forModules: [module]) != .unsupported {
                return (module, { self.follow(module.results) { String($0.text.characters) } })
            }
        }
        if let match = await DictationTranscriber.supportedLocale(equivalentTo: locale) {
            let module = DictationTranscriber(locale: match, preset: .progressiveShortDictation)
            if await AssetInventory.status(forModules: [module]) != .unsupported {
                return (module, { self.follow(module.results) { String($0.text.characters) } })
            }
        }
        throw VoiceError.unsupportedLanguage
    }

    /// Keeps `partial` current: finished phrases accumulate, the phrase
    /// still being heard is replaced each time the recogniser revises it.
    private func follow<Result: SpeechModuleResult & Sendable>(
        _ results: some AsyncSequence<Result, any Error> & Sendable,
        text: @escaping @Sendable (Result) -> String
    ) -> Task<Void, Never> {
        Task {
            do {
                for try await result in results {
                    if result.isFinal {
                        finalized += text(result)
                        volatile = ""
                    } else {
                        volatile = text(result)
                    }
                }
            } catch {}
        }
    }

    /// Converts a microphone buffer to the format the recogniser wants.
    private nonisolated static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter) -> AVAudioPCMBuffer? {
        let ratio = converter.outputFormat.sampleRate / converter.inputFormat.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up))
        guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else { return nil }
        nonisolated(unsafe) var pending: AVAudioPCMBuffer? = buffer
        let status = converter.convert(to: output, error: nil) { _, inputStatus in
            inputStatus.pointee = pending == nil ? .noDataNow : .haveData
            defer { pending = nil }
            return pending
        }
        return status == .error ? nil : output
    }

    // MARK: Talking

    /// Rises with each word and falls away after it: the synthesizer gives
    /// no audio level, but it says when every word starts.
    var outputLevel: Double {
        guard speaking != nil else { return 0 }
        let sinceWord = (ContinuousClock.now - lastWord) / .milliseconds(320)
        return max(0.25, 1 - sinceWord)
    }

    func speak(_ text: String) async {
        guard !text.isEmpty else { return }
        stopSpeaking()
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        await withTaskCancellationHandler {
            await withCheckedContinuation { done in
                speaking = (ObjectIdentifier(utterance), done)
                synthesizer.speak(utterance)
            }
        } onCancel: {
            Task { @MainActor in self.stopSpeaking() }
        }
    }

    func stopSpeaking() {
        synthesizer.stopSpeaking(at: .immediate)
        speaking?.done.resume()
        speaking = nil
    }

    private func ended(_ utterance: ObjectIdentifier) {
        guard speaking?.utterance == utterance else { return }
        speaking?.done.resume()
        speaking = nil
    }

    /// The best installed voice for a locale: the highest quality the owner
    /// has downloaded for the language, otherwise the system's default.
    static func bestVoice(for locale: Locale) -> AVSpeechSynthesisVoice? {
        let standard = AVSpeechSynthesisVoice(language: locale.identifier(.bcp47))
        let code = locale.language.languageCode
        func rank(_ voice: AVSpeechSynthesisVoice) -> (Int, Int, Int) {
            (voice.quality.rawValue, voice.language == standard?.language ? 1 : 0, voice.identifier == standard?.identifier ? 1 : 0)
        }
        return AVSpeechSynthesisVoice.speechVoices()
            .filter { Locale(identifier: $0.language).language.languageCode == code }
            .filter { $0.voiceTraits.isDisjoint(with: [.isNoveltyVoice, .isPersonalVoice]) }
            .max { rank($0) < rank($1) } ?? standard
    }
}

extension DeviceVoice: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString range: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor in lastWord = .now }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let utterance = ObjectIdentifier(utterance)
        Task { @MainActor in ended(utterance) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let utterance = ObjectIdentifier(utterance)
        Task { @MainActor in ended(utterance) }
    }
}
