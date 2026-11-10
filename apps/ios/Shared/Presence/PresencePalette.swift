import SwiftUI

extension Presence {
    /// How one state looks: the body's gradient, the light inside it, the glow around it.
    struct Look: Equatable, Sendable {
        var from, to, core, halo: RGB
        /// Glow opacity at its strongest.
        var glow: Double
    }

    /// Which colour of a look.
    enum Channel: Int, Sendable {
        case from, to, core, halo
    }

    /// The presence's colours, and how they mix: a port of
    /// `packages/presence/src/palette.ts`. The colours themselves are the
    /// design tokens (`Tokens.Presence`); this only reads them. They mix in
    /// OKLab, where equal steps look equal; when two coloured states meet,
    /// the mix leans towards `via` (the pearl on black, the ink on light) by
    /// as much colour as it would lose, so that azure into amber never goes
    /// through mud.
    enum Palette {
        /// The colours of `state` on `theme`.
        static func look(_ theme: Theme, _ state: State) -> Look {
            looks[theme == .dark ? 0 : 1][state.rawValue]
        }

        private static let looks: [[Look]] = [Theme.dark, .light].map { theme in
            State.allCases.map { state in
                let pair = switch state {
                case .idle: Tokens.Presence.idle
                case .working: Tokens.Presence.working
                case .waiting: Tokens.Presence.waiting
                case .listening: Tokens.Presence.listening
                case .speaking: Tokens.Presence.speaking
                case .offline: Tokens.Presence.offline
                }
                let token = theme == .dark ? pair.dark : pair.light
                return Look(from: rgb(token.from), to: rgb(token.to), core: rgb(token.core), halo: rgb(token.halo), glow: token.glow)
            }
        }

        /// What a change between two coloured states travels through.
        static func via(_ theme: Theme) -> RGB {
            RGB(theme == .dark ? Tokens.Presence.via.dark : Tokens.Presence.via.light)
        }

        /// A token colour back to the whole numbers it was written with.
        private static func rgb(_ color: Color) -> RGB {
            let resolved = color.resolve(in: EnvironmentValues())
            return RGB(red: (Double(resolved.red) * 255).rounded(), green: (Double(resolved.green) * 255).rounded(), blue: (Double(resolved.blue) * 255).rounded())
        }

        // MARK: OKLab (Björn Ottosson, 2020)

        /// sRGB channel 0–255 → linear light 0–1.
        static func toLinear(_ c: Double) -> Double {
            let x = c / 255
            return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4)
        }

        /// Linear light 0–1 → sRGB channel 0–255.
        static func fromLinear(_ x: Double) -> Double {
            let c = min(1, max(0, x))
            return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055)
        }

        private static func oklab(_ c: RGB) -> (Double, Double, Double) {
            let r = toLinear(c.red), g = toLinear(c.green), b = toLinear(c.blue)
            let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
            let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
            let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
            return (
                0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
                1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
                0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s)
        }

        private static func srgb(_ L: Double, _ A: Double, _ B: Double) -> RGB {
            let l = pow(L + 0.3963377774 * A + 0.2158037573 * B, 3)
            let m = pow(L - 0.1055613458 * A - 0.0638541728 * B, 3)
            let s = pow(L - 0.0894841775 * A - 1.291485548 * B, 3)
            return RGB(
                red: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
                green: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
                blue: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))
        }

        /// Every palette colour in OKLab: [theme][channel][state].
        private static let lab: [[[(Double, Double, Double)]]] = [Theme.dark, .light].map { theme in
            [Channel.from, .to, .core, .halo].map { channel in
                State.allCases.map { state in
                    let look = look(theme, state)
                    return oklab([look.from, look.to, look.core, look.halo][channel.rawValue])
                }
            }
        }

        private static let viaLab = [oklab(via(.dark)), oklab(via(.light))]

        private static func smooth(_ from: Double, _ to: Double, _ x: Double) -> Double {
            let t = min(1, max(0, (x - from) / (to - from)))
            return t * t * (3 - 2 * t)
        }

        /// Mixes one colour of every state by `weights` (one per state, each 0–1, summing to 1), as sRGB 0–255.
        static func mix(_ weights: [Double], _ theme: Theme, _ channel: Channel) -> RGB {
            let table = lab[theme == .dark ? 0 : 1][channel.rawValue]
            var L = 0.0, A = 0.0, B = 0.0, chroma = 0.0
            for s in 0..<6 where weights[s] != 0 {
                let w = weights[s], c = table[s]
                L += w * c.0
                A += w * c.1
                B += w * c.2
                chroma += w * (c.1 * c.1 + c.2 * c.2).squareRoot()
            }
            // How much colour two hues cancelling out would lose: lean that much towards `via`.
            let lost = smooth(0.02, 0.09, chroma - (A * A + B * B).squareRoot())
            let via = viaLab[theme == .dark ? 0 : 1]
            return srgb(L + (via.0 - L) * lost, A + (via.1 - A) * lost, B + (via.2 - B) * lost)
        }
    }
}
