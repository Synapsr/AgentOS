import AVFAudio
import Foundation
import Testing
@testable import AgentOS

@Suite @MainActor struct VoiceTests {
    @Test(arguments: ["en", "en-US", "fr", "fr-CA"])
    func picksAVoiceThatSpeaksTheLanguage(_ language: String) throws {
        let locale = Locale(identifier: language)
        let voice = try #require(DeviceVoice.bestVoice(for: locale))
        #expect(Locale(identifier: voice.language).language.languageCode == locale.language.languageCode)
        #expect(voice.voiceTraits.isDisjoint(with: [.isNoveltyVoice, .isPersonalVoice]))
        // Nothing installed for the language is better than what was picked.
        let best = AVSpeechSynthesisVoice.speechVoices()
            .filter { Locale(identifier: $0.language).language.languageCode == locale.language.languageCode }
            .map(\.quality.rawValue).max()
        #expect(voice.quality.rawValue == best)
    }
}
