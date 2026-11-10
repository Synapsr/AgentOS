import AVFAudio
import Synchronization
import UniformTypeIdentifiers

/// Speech done by the computer, when its owner gave it a key for a premium
/// voice: the phone records the utterance and plays back what the computer
/// synthesises. The key never leaves the computer.
@MainActor
final class ServerVoice: NSObject, VoiceEngine {
    private let client: NodeClient
    private let language: String
    private let ttsMime: String?
    private let microphone: Microphone

    private var recording: (file: AVAudioFile, url: URL)?
    /// The loudest moment of the recording so far.
    private nonisolated let loudest = Mutex(0.0)
    private var player: AVAudioPlayer?
    private var playing: CheckedContinuation<Void, Never>?

    /// - Parameter ttsMime: what `POST /v1/voice/speak` returns, from the node's capabilities.
    init(client: NodeClient, language: String, ttsMime: String?, microphone: Microphone) {
        self.client = client
        self.language = language
        self.ttsMime = ttsMime
        self.microphone = microphone
    }

    // MARK: Hearing

    /// The computer only answers once it has the whole utterance.
    var partial: String? { nil }

    func startListening() async throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "utterance-\(UUID().uuidString).m4a")
        let format = microphone.format
        let file = try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
        ])
        recording = (file, url)
        loudest.withLock { $0 = 0 }
        microphone.sink = { [self] buffer in
            try? file.write(from: buffer)
            loudest.withLock { $0 = max($0, Microphone.loudness(of: buffer)) }
        }
    }

    func finishListening() async throws -> String {
        microphone.sink = nil
        guard let recording else { return "" }
        self.recording = nil
        recording.file.close()
        defer { try? FileManager.default.removeItem(at: recording.url) }
        // Speech models find words in silence, and those words would be
        // sent in the owner's name: a recording nobody talked in goes nowhere.
        guard loudest.withLock({ $0 }) > Microphone.voice else { return "" }
        let audio = try Data(contentsOf: recording.url)
        return try await client.transcribe(audio: audio, mime: "audio/mp4", language: language)
    }

    // MARK: Talking

    var outputLevel: Double {
        guard let player, player.isPlaying else { return microphone.playbackLevel }
        player.updateMeters()
        return min(max((Double(player.averagePower(forChannel: 0)) + 50) / 40, 0), 1)
    }

    /// Fetches the whole clip, then plays it: simple, at the price of a
    /// short wait before a long sentence starts.
    func speak(_ text: String) async {
        stopSpeaking()
        let type = ttsMime.flatMap { UTType(mimeType: $0) }
        guard let audio = try? await client.speak(text), !Task.isCancelled else { return }
        // In Live mode the voice goes through the microphone's engine, so
        // that the owner's music is quieted while it talks.
        if microphone.quietsOtherAudio {
            let url = FileManager.default.temporaryDirectory
                .appending(path: "voice-\(UUID().uuidString)").appendingPathExtension(type?.preferredFilenameExtension ?? "mp3")
            defer { try? FileManager.default.removeItem(at: url) }
            guard (try? audio.write(to: url)) != nil, let clip = try? AVAudioFile(forReading: url) else { return }
            await withTaskCancellationHandler {
                await microphone.play(clip)
            } onCancel: {
                Task { @MainActor in self.stopSpeaking() }
            }
            return
        }
        guard let player = try? AVAudioPlayer(data: audio, fileTypeHint: type?.identifier) else { return }
        player.delegate = self
        player.isMeteringEnabled = true
        self.player = player
        await withTaskCancellationHandler {
            await withCheckedContinuation { done in
                playing = done
                if !player.play() { stopSpeaking() }
            }
        } onCancel: {
            Task { @MainActor in self.stopSpeaking() }
        }
    }

    func stopSpeaking() {
        microphone.stopPlaying()
        player?.stop()
        player = nil
        playing?.resume()
        playing = nil
    }
}

extension ServerVoice: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let finished = ObjectIdentifier(player)
        Task { @MainActor in
            if let current = self.player, ObjectIdentifier(current) == finished { stopSpeaking() }
        }
    }
}
