import AVFAudio
import Accelerate
import Synchronization

/// Ears and a mouth. The agent is always the brain; a voice engine only
/// converts between sound and words — on this phone (`DeviceVoice`) or on
/// the computer (`ServerVoice`), as the computer's `capabilities.voice` says.
@MainActor
protocol VoiceEngine: AnyObject {
    /// Starts turning what the microphone hears into words.
    func startListening() async throws
    /// The words recognised so far, or nil when this engine only knows them
    /// once listening has finished.
    var partial: String? { get }
    /// Stops listening and returns everything that was said.
    func finishListening() async throws -> String

    /// Says `text` aloud. Returns when it has been said, or stopped.
    func speak(_ text: String) async
    func stopSpeaking()
    /// Loudness of the voice right now, 0…1.
    var outputLevel: Double { get }
}

enum VoiceError: Error {
    /// The owner has not allowed the microphone.
    case microphoneDenied
    /// The audio route has no input to listen to.
    case noMicrophone
    /// This phone cannot recognise speech in the agent's language.
    case unsupportedLanguage
}

/// The microphone: one tap on an audio engine, handed to whoever is
/// listening. In Live mode the same engine can also play the computer's
/// voice (see `quietOtherAudioWhileVoicesTalk`).
@MainActor
final class Microphone {
    typealias Sink = @Sendable (AVAudioPCMBuffer) -> Void

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let tap = Tap()

    /// Format of the buffers given to `sink`.
    var format: AVAudioFormat { engine.inputNode.outputFormat(forBus: 0) }

    /// Loudness of what the microphone hears right now, 0…1.
    var level: Double { tap.level.withLock { $0 } }

    /// The loudness from which a sound counts as someone talking.
    nonisolated static let voice = 0.45

    /// Maps a buffer's RMS from −50…−10 dB onto 0…1.
    nonisolated static func loudness(of buffer: AVAudioPCMBuffer) -> Double {
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        let rms = vDSP.rootMeanSquare(UnsafeBufferPointer(start: samples, count: Int(buffer.frameLength)))
        let decibels = 20 * log10(Double(max(rms, 1e-7)))
        return min(max((decibels + 50) / 40, 0), 1)
    }

    /// Loudness of what `play` is playing right now, 0…1.
    var playbackLevel: Double { tap.played.withLock { $0 } }

    /// Receives every buffer, on the audio thread. Once this has been set
    /// to nil, the previous sink is never called again.
    var sink: Sink? {
        get { tap.sink.withLock { $0 } }
        set { tap.sink.withLock { $0 = newValue } }
    }

    /// Starts (or restarts, after the audio route changed) capturing.
    func start() throws {
        // A restart means the engine stopped under whatever was playing.
        stopPlaying()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        // Tapping an input that is not there is a crash, not an error.
        guard format.sampleRate > 0, format.channelCount > 0 else { throw VoiceError.noMicrophone }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: tap.block)
        engine.prepare()
        try engine.start()
    }

    func stop() {
        stopPlaying()
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        // Voice processing is for Live mode only: hold to talk wants the plain microphone.
        if quietsOtherAudio { try? engine.inputNode.setVoiceProcessingEnabled(false) }
        tap.level.withLock { $0 = 0 }
    }

    // MARK: Live mode, when the computer does the talking

    /// True once `quietOtherAudioWhileVoicesTalk` is in force.
    var quietsOtherAudio: Bool { engine.inputNode.isVoiceProcessingEnabled }

    /// Lets the owner's music play at full volume and quiets it only while
    /// a voice is heard — the agent's or the owner's. Call it before `start`.
    ///
    /// Live mode keeps one audio session active for hours, and a session's
    /// own `duckOthers` only gives the volume back when the session is
    /// deactivated — which would end Live mode. What Apple provides for a
    /// session that stays active is voice processing with "advanced
    /// ducking": other audio is lowered when voice activity is detected on
    /// either side of the conversation, and only then. The agent's voice
    /// counts as a side of the conversation only if it is played through
    /// this engine: hence `play`.
    ///
    /// The phone's own voice does not need this: the system quiets other
    /// audio around `AVSpeechSynthesizer` by itself.
    func quietOtherAudioWhileVoicesTalk() throws {
        let input = engine.inputNode
        guard !input.isVoiceProcessingEnabled else { return }
        // Voice processing can only be switched while the engine is stopped.
        engine.stop()
        try input.setVoiceProcessingEnabled(true)
        input.voiceProcessingOtherAudioDuckingConfiguration = .init(enableAdvancedDucking: true, duckingLevel: .min)
    }

    /// Plays a clip through the engine the microphone is on. Returns when
    /// it has been played, or stopped.
    func play(_ clip: AVAudioFile) async {
        // Playing on an engine that is not running is a crash, not an error.
        guard engine.isRunning else { return }
        if player.engine == nil { engine.attach(player) }
        engine.connect(player, to: engine.mainMixerNode, format: clip.processingFormat)
        player.installTap(onBus: 0, bufferSize: 1024, format: nil, block: tap.playbackBlock)
        await withCheckedContinuation { done in
            // Called on an audio thread — also when the player is stopped.
            let finished: @Sendable (AVAudioPlayerNodeCompletionCallbackType) -> Void = { _ in done.resume() }
            player.scheduleFile(clip, at: nil, completionCallbackType: .dataPlayedBack, completionHandler: finished)
            player.play()
        }
        player.removeTap(onBus: 0)
        tap.played.withLock { $0 = 0 }
    }

    func stopPlaying() {
        if player.engine != nil { player.stop() }
    }

    /// What runs on the audio thread, kept apart from the main actor.
    private final class Tap: Sendable {
        let sink = Mutex<Sink?>(nil)
        let level = Mutex(0.0)
        let played = Mutex(0.0)

        var playbackBlock: AVAudioNodeTapBlock {
            { [self] buffer, _ in played.withLock { $0 = Microphone.loudness(of: buffer) } }
        }

        var block: AVAudioNodeTapBlock {
            { [self] buffer, _ in
                level.withLock { $0 = Microphone.loudness(of: buffer) }
                sink.withLock { $0?(buffer) }
            }
        }
    }
}

/// The app's audio session, in its three uses.
///
/// Live mode is the delicate one. iOS lets an app start recording only while
/// it is on screen, and keeps it running in the background only while it
/// really plays or records. So Live mode starts on the owner's tap and keeps
/// the microphone open, mixed with whatever music is playing, for as long as
/// it lasts. What the microphone hears is only looked at while a reply is
/// expected; the rest of the time it is measured and dropped.
@MainActor
enum AudioSession {
    private static var session: AVAudioSession { .sharedInstance() }

    /// Hold to talk: record for a moment, quieting other audio meanwhile.
    static func beginRecording() throws {
        try session.setCategory(.playAndRecord, mode: .default, options: [.duckOthers, .allowBluetoothA2DP, .defaultToSpeaker])
        try session.setActive(true)
    }

    /// Saying one thing aloud over other audio, as a navigation app does.
    static func beginSpeaking() throws {
        try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try session.setActive(true)
    }

    /// Live mode: listen and talk for a long time without stopping the
    /// owner's music. A2DP keeps that music in full quality; the owner is
    /// heard through the phone's microphone, or through earbuds that can
    /// record in high quality (recent AirPods). Hands-free Bluetooth (HFP)
    /// is left out on purpose: it would hear through any earbuds, but turns
    /// everything playing — the music too — into telephone sound.
    static func beginLive() throws {
        try session.setCategory(
            .playAndRecord, mode: .default,
            options: [.mixWithOthers, .allowBluetoothA2DP, .bluetoothHighQualityRecording, .defaultToSpeaker])
        try session.setActive(true)
    }

    /// Gives the audio back: other apps return to full volume.
    static func end() {
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// True when only the owner hears the phone (earbuds, headphones).
    static var isPrivate: Bool {
        let personal: Set<AVAudioSession.Port> = [.headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE]
        return session.currentRoute.outputs.contains { personal.contains($0.portType) }
    }
}
