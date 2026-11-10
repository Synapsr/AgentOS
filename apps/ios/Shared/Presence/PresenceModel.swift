import Foundation

/// The presence, as numbers: three drops of light that behave as one liquid
/// body.
///
/// A Swift port of `packages/presence/src/model.ts`, kept line for line and
/// name for name so that the two can be read side by side; the words are in
/// docs/PRESENCE.md. `Presence.frame` is a pure function: given how much of
/// each state is showing, the time, the voice and the size, it returns three
/// pills, the membranes that join them, three glows, a gradient, and what
/// the light inside the body is doing. Its "randomness" is a seeded integer
/// hash, so `PresenceTests` can hold it to the TypeScript model's numbers.
///
/// Positions inside this file are in stage units (centre 0,0 — edges at ±1 —
/// y grows downwards); a frame is in points, relative to the centre of the
/// stage.
enum Presence {
    /// What the agent is doing, as shown by the presence.
    enum State: Int, CaseIterable, Codable, Sendable {
        case idle, working, waiting, listening, speaking, offline
    }

    /// The surface the presence sits on: light on black, or a black pearl on a light surface.
    enum Theme: String, Sendable {
        case dark, light
    }

    /// How much of each state is showing. The weights normally sum to 1; a
    /// spring may push them slightly past 0 or 1.
    struct Blend: Equatable, Sendable {
        /// One weight per state, in the order of `State.allCases`.
        var weights: [Double]

        init(weights: [Double]) {
            self.weights = weights
        }

        /// A blend that shows a single state.
        init(only state: State, weight: Double = 1) {
            weights = State.allCases.map { $0 == state ? weight : 0 }
        }

        subscript(state: State) -> Double {
            get { weights[state.rawValue] }
            set { weights[state.rawValue] = newValue }
        }
    }

    /// A colour as red, green, blue, each 0–255.
    struct RGB: Equatable, Sendable {
        var red, green, blue: Double

        init(_ hex: UInt32) {
            red = Double((hex >> 16) & 0xFF)
            green = Double((hex >> 8) & 0xFF)
            blue = Double(hex & 0xFF)
        }

        init(red: Double, green: Double, blue: Double) {
            self.red = red
            self.green = green
            self.blue = blue
        }
    }

    /// Something that just happened, answered by the body: the owner said
    /// "go ahead" (a nod), said "stop" (the hand lowered), or the computer is
    /// trying to reconnect (the dash lifts once).
    enum PulseKind: String, Sendable {
        case approved, denied, retry
    }

    /// A pulse and when it happened, in seconds on the clock of `time`.
    struct Pulse: Equatable, Sendable {
        var kind: PulseKind
        var at: Double
    }

    /// The voice beyond its level, as `Motion` follows it.
    struct Voice: Equatable, Sendable {
        /// The level followed slowly (about half a second): someone is talking.
        var slow = 0.0
        /// How high each speaking drop has bounced — big, middle, small — in stage units. Below 0 it squashes.
        var lift = [0.0, 0.0, 0.0]
        /// When the last syllable began, in seconds on the clock of `time`.
        var onset = -1.0
        /// How sharp that syllable was, 0–1.
        var strength = 0.0
    }

    /// Everything the look depends on. Only the blends, the time and the size are needed; the rest makes it move like matter.
    struct Input: Sendable {
        /// One blend per drop: big, middle, small.
        var blends: [Blend]
        var time: Double
        /// Voice level, 0–1.
        var level = 0.0
        var size: Double
        var theme = Theme.dark
        /// Reduced motion: keep each state's shape, drop everything that travels.
        var calm = false
        /// When the last change of state began: the body gathers itself for a moment after it.
        var changed: Double?
        /// When waiting last began: it times the waiting wave and its patience.
        var asked: Double?
        /// Rate of change of each drop's blend, per second: drops stretch along their travel.
        var velocity: [Blend]?
        /// How much of each state's colour and light shows. Without it, the drops' blends averaged.
        var tint: Blend?
        /// The voice, followed in time. Without it the figure follows `level` alone.
        var voice: Voice?
        /// The last pulse, if any.
        var pulse: Pulse?
        /// How far the inner light has flowed, in stage units. Without it, it follows `time`.
        var flow: Double?
        /// Picks the sequence of small idle gestures.
        var seed = 0
    }

    /// A pill centred on (x, y): a rectangle with fully round ends, `w` along
    /// its own axis, turned by `angle` (radians, clockwise on screen, never
    /// more than a quarter turn). A circle when `w == h`.
    struct Pill: Equatable, Sendable {
        var x, y, w, h: Double
        var angle = 0.0
    }

    /// A soft disc of light behind a drop: full `alpha` at the centre, nothing at `r`.
    struct Glow: Equatable, Sendable {
        var x, y, r, alpha: Double
    }

    /// What the body is made of, for renderers that draw light (the Metal shader). Lengths in points.
    struct Light: Equatable, Sendable {
        /// The colour at the heart of the body.
        var core = RGB(0)
        /// How much light is inside the body, 0–1.
        var energy = 0.0
        /// How far the inner light has flowed, in stage units.
        var flow = 0.0
        /// −1 the inner light flows inward (listening), 1 outward (speaking).
        var radial = 0.0
        /// Strength of the light around the body, 0–1.
        var bloom = 0.0
        /// Strength of the light along the top edge, 0–1: the black pearl's gloss on a light surface.
        var rim = 0.0
        /// How far the outline wanders.
        var wobble = 0.0
        /// How softly drops melt into one: the distance across which two edges join.
        var merge = 0.0
        /// A ring of light that follows a syllable: radius, width, strength.
        var wave = [0.0, 0.0, 0.0]
        /// Seconds: the clock of the wobble.
        var time = 0.0
    }

    /// One drawable frame, in points relative to the centre of the stage.
    struct Frame: Equatable, Sendable {
        /// Side of the stage this frame was made for.
        var size: Double
        /// Big, middle, small — always three.
        var drops: [Pill]
        /// Big–middle, big–small, middle–small: eight points each, as x,y
        /// pairs, for the closed path `M 0  C 1 2 3  L 4  C 5 6 7  Z`.
        var bridges: [[Double]]
        /// No state opens it any more: always of no size, kept so that a frame keeps its shape.
        var hole: Pill
        /// One per drop, drawn behind everything.
        var glows: [Glow]
        /// The body's gradient, from the top left of the stage to the bottom right.
        var from, to: RGB
        /// Colour of the glows.
        var halo: RGB
        /// The light inside the body.
        var light: Light
    }

    // MARK: Small maths

    private static let tau = Double.pi * 2

    private static func length(_ x: Double, _ y: Double) -> Double {
        (x * x + y * y).squareRoot()
    }

    private static func clamp(_ x: Double, _ low: Double = 0, _ high: Double = 1) -> Double {
        min(high, max(low, x))
    }

    private static func smoothstep(_ from: Double, _ to: Double, _ x: Double) -> Double {
        let t = clamp((x - from) / (to - from))
        return t * t * (3 - 2 * t)
    }

    /// 0 outside [a, b]; rises and falls once inside, with no corner at either end.
    private static func bump(_ x: Double, _ a: Double, _ b: Double) -> Double {
        x <= a || x >= b ? 0 : pow(sin(Double.pi * (x - a) / (b - a)), 2)
    }

    /// How a spring of perceptual `duration` and `bounce` moves from 0 to 1, `t` seconds after it is let go.
    static func settle(_ t: Double, _ duration: Double, _ bounce: Double) -> Double {
        if t <= 0 { return 0 }
        let w = tau / duration, z = 1 - bounce
        if z >= 1 { return 1 - (1 + w * t) * exp(-w * t) }
        let wd = w * (1 - z * z).squareRoot()
        return 1 - exp(-z * w * t) * (cos(wd * t) + (z * w / wd) * sin(wd * t))
    }

    /// A repeatable number in 0–1 for a whole number and a seed: 32-bit integer arithmetic, so that every platform agrees to the bit.
    static func hash(_ n: Double, _ seed: Int = 0) -> Double {
        let i = UInt32(truncatingIfNeeded: Int64(n))
        let s = UInt32(truncatingIfNeeded: Int64(seed) + 0x9E37_79B9)
        var h = (i &* 0x27D4_EB2D) ^ (s &* 0x1656_67B1)
        h = (h ^ (h >> 15)) &* 0x85EB_CA6B
        h = (h ^ (h >> 13)) &* 0xC2B2_AE35
        return Double(h ^ (h >> 16)) / 4_294_967_296
    }

    /// Smooth seeded noise, −1 … 1.
    private static func noise(_ x: Double, _ seed: Int) -> Double {
        let i = x.rounded(.down), f = x - i
        let e = f * f * f * (f * (f * 6 - 15) + 10)
        let a = hash(i, seed), b = hash(i + 1, seed)
        return 2 * (a + (b - a) * e) - 1
    }

    /// Two octaves of noise: a slow wander with a little detail.
    private static func drift(_ x: Double, _ seed: Int) -> Double {
        0.7 * noise(x, seed) + 0.3 * noise(2.13 * x + 17.3, seed + 7)
    }

    /// A breath, −1 … 1, in for 40 % of `period` and out for 60 %, its phase wandering a little.
    private static func breathe(_ t: Double, _ period: Double, _ seed: Int) -> Double {
        let phase = t / period + 0.08 * drift(t / 13, seed)
        let f = phase - phase.rounded(.down)
        return f < 0.4 ? -cos(Double.pi * f / 0.4) : cos(Double.pi * (f - 0.4) / 0.6)
    }

    /// How much the figure is simplified for small sizes: 0 from 72 points up, 1 at 28 and below.
    static func tininess(_ size: Double) -> Double {
        1 - smoothstep(28, 72, size)
    }

    // MARK: The scene of one instant

    /// Radius of the body at rest, in stage units: it fills half the stage.
    static let rest = 0.5
    private static let apart = [0.3, 0.22, 0.15]
    private static let thicker = [0.15, 0.27, 0.5]
    private static let idleSlot = 10.5
    private static let waitFirst = 0.35
    private static let dot = [0.19, 0.135, 0.135]

    private enum IdleKind { case glance, settle, stretch }

    /// Everything a choreography may depend on, for one instant.
    private struct Scene {
        var t = 0.0, level = 0.0, slow = 0.0, tiny = 0.0
        var calm = false
        var live = 1.0, gate = 1.0
        var seed = 0
        var lift: [Double]?
        var idleKind = IdleKind.glance
        var idleU = -1.0, idleSide = 1.0, idleAngle = 0.0, idleLook = 1.0
        var waitU = -1.0, waitAmp = 1.0
        // Shared by the three drops at this instant.
        var rest = (r: 0.0, x: 0.0, y: 0.0, w: 0.0, h: 0.0, turn: 0.0, peek: 0.0, look: 0.0)
        var juggle = (reach: 0.0, cos: 1.0, sin: 0.0)
        var lean = 0.0
    }

    private typealias Pose = (x: Double, y: Double, w: Double, h: Double, angle: Double)

    /// Which idle gesture plays at `t`, and how far into it.
    private static func idleGesture(_ t: Double, _ seed: Int, into scene: inout Scene) {
        let n = (t / idleSlot).rounded(.down)
        scene.idleU = t - (n * idleSlot + 3.5 * hash(n, seed + 101))
        let kind = hash(n, seed + 202)
        scene.idleKind = kind < 0.75 ? .glance : kind < 0.92 ? .settle : .stretch
        scene.idleSide = hash(n, seed + 303) < 0.3 ? -1 : 1
        scene.idleAngle = -Double.pi / 2 + scene.idleSide * (0.3 + 0.6 * hash(n, seed + 404))
        scene.idleLook = hash(n, seed + 505) < 0.5 ? -1 : 1
    }

    /// Where the waiting wave is, `held` seconds after waiting began: patience, not nagging.
    private static func waitingCycle(_ held: Double, into scene: inout Scene) {
        let x = held - waitFirst
        if x < 0 {
            scene.waitU = x
            scene.waitAmp = 1
        } else if x < 57.6 {
            scene.waitU = x.truncatingRemainder(dividingBy: 4.8)
            scene.waitAmp = 1
        } else if x < 300.8 {
            scene.waitU = (x - 57.6).truncatingRemainder(dividingBy: 6.4)
            scene.waitAmp = 0.7
        } else {
            scene.waitU = (x - 300.8).truncatingRemainder(dividingBy: 9.6)
            scene.waitAmp = 0.6
        }
    }

    /// True while an idle gesture or the waiting wave is playing: the moments worth 60 frames a second.
    static func gesturing(_ state: State, time: Double, asked: Double, seed: Int = 0) -> Bool {
        var scene = Scene()
        switch state {
        case .idle:
            idleGesture(time, seed, into: &scene)
            return scene.idleU > -0.1 && scene.idleU < 3.2
        case .waiting:
            waitingCycle(time - asked, into: &scene)
            return scene.waitU > -0.1 && scene.waitU < 1.6
        default:
            return false
        }
    }

    /// The small seeded lean of a silent listener.
    private static func leanAt(_ t: Double, _ seed: Int) -> Double {
        let n = (t / 6.5).rounded(.down)
        let u = t - (n * 6.5 + 2.5 * hash(n, seed + 707))
        return settle(u, 0.5, 0.1) - settle(u - 0.9, 0.7, 0)
    }

    /// Works out what the three drops share at this instant: the idle body, the juggle, the lean.
    private static func share(_ scene: inout Scene) {
        let t = scene.t, tiny = scene.tiny, live = scene.live, seed = scene.seed, gate = scene.gate
        // Idle: a breath longer out than in, a slow wander, never quite round.
        let r = rest * (1 + 0.48 * tiny) * (1 + 0.035 * live * (1 - 0.5 * tiny) * breathe(t, 5, seed))
        var x = live * 0.02 * drift(t / 5.3, seed + 11)
        var y = live * 0.018 * drift(t / 6.1, seed + 13)
        let oval = live * 0.022 * (1 - tiny) * drift(t / 2.9, seed + 17)
        let turn = live * 0.9 * drift(t / 23, seed + 19)
        let u = scene.idleU
        var w = 2 * r * (1 + oval), h = 2 * r * (1 - oval), peek = 0.0
        if gate > 0, u > 0 {
            switch scene.idleKind {
            case .glance:
                peek = gate * (settle(u, 0.55, 0.25) - settle(u - 1.55, 0.65, 0))
            case .settle:
                let s = gate * (settle(u, 0.6, 0) - settle(u - 1.4, 0.7, 0.15))
                w *= 1 + 0.032 * s
                h *= 1 - 0.032 * s
                y += 0.02 * s
            case .stretch:
                let s = gate * (settle(u, 1, 0) - settle(u - 1.2, 1.2, 0.1))
                h *= 1 + 0.05 * s
                w *= 1 - 0.028 * s
                y -= 0.022 * s
            }
        }
        let look = scene.idleAngle + scene.idleLook * 0.28 * smoothstep(0.7, 1.3, u)
        x += 0.014 * peek * cos(look)
        y += 0.014 * peek * sin(look)
        scene.rest = (r, x, y, w, h, turn, peek, look)
        // Working: the figure's reach and turn.
        let reach = 0.58 - 0.07 * tiny + 0.03 * drift(t / 7, seed + 29)
        let spin = t * tau / 40 + 0.35 * drift(t / 31, seed + 31)
        scene.juggle = (reach, cos(spin), sin(spin))
        // Listening: someone talking makes it lean in; in silence, a small lean now and then.
        scene.lean = live * max(scene.slow, 0.35 * gate * leanAt(t, seed))
    }

    // MARK: The choreography

    /// Idle — resting, content.
    private static func idle(_ k: Int, _ scene: Scene) -> Pose {
        let rest = scene.rest
        if k == 0 { return (rest.x, rest.y, rest.w, rest.h, rest.turn) }
        if k == 1 { return (rest.x, rest.y, 0.6, 0.6, 0) }
        let rs = 0.15
        let d = rest.peek * (rest.r + rs + 0.035)
        return (rest.x + d * cos(rest.look), rest.y + d * sin(rest.look), 2 * rs, 2 * rs, 0)
    }

    /// Working — absorbed, kneading: three drops juggling along a figure of eight.
    private static func working(_ k: Int, _ scene: Scene) -> Pose {
        let t = scene.t, tiny = scene.tiny, kk = Double(k)
        let r = apart[k] * (1 + thicker[k] * tiny)
        if scene.calm {
            let a = -Double.pi / 2 + kk * tau / 3
            let swell = 1 + 0.1 * max(0, sin(t * tau / 2.4 - kk * tau / 3))
            let reach = 0.46 - 0.06 * tiny
            return (reach * cos(a), reach * sin(a) + 0.06, 2 * r * swell, 2 * r * swell, 0)
        }
        let phase = t * tau / 4.2 + kk * tau / 3 + 0.25 * drift(t / 9 + 5 * kk, scene.seed + 23 + k)
        let a = phase + 0.22 * sin(2 * phase)
        let x = scene.juggle.reach * sin(a), y = 0.3 * sin(2 * a)
        return (x * scene.juggle.cos - y * scene.juggle.sin, x * scene.juggle.sin + y * scene.juggle.cos, 2 * r, 2 * r, 0)
    }

    private static func env(_ t: Double) -> Double {
        t <= 0 ? 0 : (1 - exp(-t / 0.08)) * exp(-t / 0.45)
    }

    /// Waiting — a raised hand: the body stands, the small drop hovers above; now and then it gathers, lifts, and waves.
    private static func waiting(_ k: Int, _ scene: Scene) -> Pose {
        let t = scene.t, tiny = scene.tiny, live = scene.live
        let size = 0.84 + 0.16 * tiny
        let ground = 0.27 + 0.09 * tiny
        if k == 1 { return (0, ground, 0.5, 0.5, 0) }
        let u = scene.waitU, amp = scene.waitAmp * scene.gate
        if k == 0 {
            let stance = 0.03 * live * (1 - tiny)
            let breath = 1 + 0.02 * live * (1 - tiny) * breathe(t, 2.6, scene.seed + 37)
            let squash = amp * (0.06 * bump(u, 0, 0.36) + 0.045 * bump(u, 0.8, 1.12) - 0.015 * bump(u, 1.12, 1.42))
            let rise = amp * 0.075 * bump(u, 0.18, 0.92)
            let w = size * (1 - stance + squash) * breath, h = size * (1 + stance - squash) * breath
            return (0, ground + (size - h) / 2 - rise, w, h, 0)
        }
        let rs = 0.15 + 0.07 * tiny
        let float = 0.02 * live * (1 - tiny) * drift(t / 1.1, scene.seed + 41)
        let lift = amp * 0.17 * (settle(u - 0.27, 0.5, 0.4) - settle(u - 0.95, 0.55, 0.2))
        let dip = amp * 0.03 * bump(u, 0, 0.3)
        let wave = amp * 0.05 * sin(tau * (u - 0.7) / 0.7) * env(u - 0.7)
        return (wave, -0.5 - 0.14 * tiny + float - lift + dip, 2 * rs, 2 * rs, 0)
    }

    /// Listening — leaning in: one soft body, wider than tall, its weight forward and down.
    private static func listening(_ k: Int, _ scene: Scene) -> Pose {
        let t = scene.t, live = scene.live, tiny = scene.tiny
        let lean = scene.lean, voice = 0.65 * scene.level + 0.35 * scene.slow
        let r = (0.47 + 0.2 * tiny + (0.12 - 0.06 * tiny) * voice) * (1 + 0.03 * live * (1 - tiny) * breathe(t, 4.2, scene.seed))
        let sway = live * 0.016 * (1 - tiny) * drift(t / 2.7, scene.seed + 47)
        let w = 2 * r * (1.06 + 0.05 * lean + sway), h = 2 * r * (0.96 - 0.04 * lean - sway)
        let y = 0.02 + 0.04 * lean
        if k == 0 { return (0, y, w, h, 0) }
        if k == 1 { return (0, y + 0.1 + 0.04 * lean, 0.6 + 0.2 * tiny, 0.6 + 0.2 * tiny, 0) }
        let rs = 0.17 + 0.08 * tiny
        return (0, y + h / 2 - rs - 0.01 + 0.03 * lean, 2 * rs, 2 * rs, 0)
    }

    /// Speaking — the dots talk: three round drops bouncing, melting into one smooth capsule when loud.
    private static func speaking(_ k: Int, _ scene: Scene) -> Pose {
        let t = scene.t, level = scene.level, tiny = scene.tiny, live = scene.live, kk = Double(k)
        var lift: Double
        if let lifts = scene.lift {
            lift = lifts[k]
        } else {
            let voice = level * (scene.calm ? 0.6 : 0.6 + 0.4 * sin(t * (k == 0 ? 9 : 7.3) + kk * 2.4))
            lift = (k == 0 ? 0.18 : 0.13) * voice
        }
        let pause = 1 + 0.05 * live * (1 - tiny) * (1 - smoothstep(0, 0.15, scene.slow)) * sin(tau * (t - 0.2 * kk) / 1.6)
        let loud = live * (1 - tiny) * smoothstep(0.4, 0.9, level)
        let r = (dot[k] + (k == 0 ? 0.05 : 0.06) * tiny + 0.03 * level + (k == 0 ? 0 : 0.055 * loud)) * pause
        lift *= 1 - 0.65 * loud
        let squash = min(0.3, max(0, -lift) * 6)
        let w = 2 * r * (1 + squash), h = 2 * r / (1 + squash)
        let x = k == 0 ? 0 : (k == 1 ? -1 : 1) * (0.44 + 0.12 * tiny - 0.2 * loud)
        return (x, 0.08 + r - h / 2 - max(0, lift), w, h, 0)
    }

    /// Offline — still and honest: a short grey dash, slightly low.
    private static func offline(_ k: Int, _ scene: Scene) -> Pose {
        let tiny = scene.tiny
        return (0, 0.2 - 0.2 * tiny, 0.58 + 0.42 * tiny, 0.085 + 0.175 * tiny, 0)
    }

    private static func pose(_ state: State, _ k: Int, _ scene: Scene) -> Pose {
        switch state {
        case .idle: idle(k, scene)
        case .working: working(k, scene)
        case .waiting: waiting(k, scene)
        case .listening: listening(k, scene)
        case .speaking: speaking(k, scene)
        case .offline: offline(k, scene)
        }
    }

    // MARK: What the body is made of

    /// Per state: energy, flow, wobble, merge softness, rim.
    private static let matter: [[Double]] = [
        [0.42, 0.07, 0.007, 0.16, 0.6],
        [0.62, 0.11, 0.011, 0.12, 0.8],
        [0.48, 0.04, 0.008, 0.14, 0.8],
        [0.36, 0.06, 0.003, 0.2, 0.8],
        [0.38, 0.05, 0.008, 0.07, 0.8],
        [0, 0, 0, 0.06, 0.25],
    ]

    /// How fast the inner light flows for the drops' blends and a voice level, in stage units a second.
    static func flowRate(_ blends: [Blend], level: Double) -> Double {
        var rate = 0.0, total = 0.0
        for s in 0..<6 {
            let w = clamp((blends[0].weights[s] + blends[1].weights[s] + blends[2].weights[s]) / 3)
            total += w
            rate += w * (matter[s][1] + (s == 3 || s == 4 ? 0.12 * clamp(level) : 0))
        }
        return total > 0 ? rate / total : 0
    }

    // MARK: Membranes

    private static func acos(_ x: Double) -> Double {
        Foundation.acos(clamp(x, -1, 1))
    }

    /// The membrane between two circles (after Hiroyuki Sato's metaballs):
    /// a thread when the gap is `gap` (by default 0.6 of the smaller radius),
    /// fattening as they touch and fuse, gone again once one is inside the
    /// other — narrowing back as it sinks in, so that nothing ever pops.
    static func bridge(_ x1: Double, _ y1: Double, _ r1: Double, _ x2: Double, _ y2: Double, _ r2: Double, gap: Double? = nil) -> [Double] {
        func at(_ x: Double, _ y: Double, _ angle: Double, _ r: Double) -> [Double] {
            [x + r * cos(angle), y + r * sin(angle)]
        }
        let d = length(x2 - x1, y2 - y1)
        let a = atan2(y2 - y1, x2 - x1)
        let reach = r1 + r2 + max(gap ?? 0.6 * min(r1, r2), 1e-9)
        let inside = d <= abs(r1 - r2)
        if r1 <= 0 || r2 <= 0 || d < 1e-9 || inside || d >= reach {
            let p = at(x1, y1, inside && r2 > r1 ? a + Double.pi : a, r1)
            let q = at(x2, y2, inside && r1 >= r2 ? a : a + Double.pi, r2)
            return p + p + q + q + q + q + p + p
        }
        let near = clamp((reach - d) / (reach - r1 - r2))
        let sunk = smoothstep(abs(r1 - r2), abs(r1 - r2) + 0.6 * min(r1, r2), d)
        let spread = 0.5 * (1 - pow(1 - near, 2)) * sunk
        let u1 = d < r1 + r2 ? acos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d)) : 0
        let u2 = d < r1 + r2 ? acos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d)) : 0
        let widest = acos((r1 - r2) / d)
        let a1 = a + u1 + (widest - u1) * spread
        let a2 = a - u1 - (widest - u1) * spread
        let a3 = a + Double.pi - u2 - (Double.pi - u2 - widest) * spread
        let a4 = a - Double.pi + u2 + (Double.pi - u2 - widest) * spread
        let p1 = at(x1, y1, a1, r1), p2 = at(x1, y1, a2, r1), p3 = at(x2, y2, a3, r2), p4 = at(x2, y2, a4, r2)
        let k = min(spread * 2.4, length(p1[0] - p3[0], p1[1] - p3[1]) / (r1 + r2)) * min(1, 2 * d / (r1 + r2))
        let lean1 = a1 - a, lean2 = Double.pi - (a3 - a)
        let l1 = r1 * (lean1 < 1.5 ? min(k, tan(lean1)) : k), l2 = r2 * (lean2 < 1.5 ? min(k, tan(lean2)) : k)
        let h1 = at(p1[0], p1[1], a1 - Double.pi / 2, l1), h2 = at(p2[0], p2[1], a2 + Double.pi / 2, l1)
        let h3 = at(p3[0], p3[1], a3 + Double.pi / 2, l2), h4 = at(p4[0], p4[1], a4 - Double.pi / 2, l2)
        return p2 + h2 + h4 + p4 + p3 + h3 + h1 + p1
    }

    // MARK: The physics

    private static let step = 1e-4
    private static let stretchGain = 0.13
    private static let stretchMax = 0.2
    private static let arc = [0.35, 0.5, 0.7]

    /// What a pulse does to the body at one instant.
    private struct Kick {
        var y = 0.0, w = 0.0, h = 0.0, hand = 0.0, light = 0.0
    }

    private static let gesture = (Tokens.Motion.gesture.duration, Tokens.Motion.gesture.bounce)
    private static let layoutSpring = (Tokens.Motion.layout.duration, Tokens.Motion.layout.bounce)
    private static let material = (Tokens.Motion.material.duration, Tokens.Motion.material.bounce)

    /// Out on a spring, and back on another `hold` seconds later.
    private static func there(_ s: Double, _ hold: Double, _ out: (Double, Double), _ back: (Double, Double)) -> Double {
        settle(s, out.0, out.1) - settle(s - hold, back.0, back.1)
    }

    /// The height of `there`, so that each pulse can be given its size exactly.
    private static func peak(_ hold: Double, _ out: (Double, Double), _ back: (Double, Double)) -> Double {
        var most = 0.0, s = 0.0
        while s < 2 {
            most = max(most, there(s, hold, out, back))
            s += 0.002
        }
        return most
    }

    private static let nod = peak(0.16, gesture, gesture)
    private static let lower = peak(0.55, layoutSpring, material)
    private static let retry = peak(0.25, gesture, gesture)

    private static func pulseAt(_ pulse: Pulse?, _ t: Double) -> Kick {
        var kick = Kick()
        guard let pulse else { return kick }
        let s = t - pulse.at
        if s < 0 || s > 3 { return kick }
        switch pulse.kind {
        case .approved:
            let nod = 0.04 * there(s, 0.16, gesture, gesture) / Self.nod
            kick.y = nod
            kick.w = 0.5 * nod
            kick.h = -0.6 * nod
            kick.hand = 0.6
            kick.light = 0.14 * (1 - exp(-s / 0.04)) * exp(-s / 0.35)
        case .denied:
            let low = there(s, 0.55, layoutSpring, material) / lower
            kick.y = 0.022 * low
            kick.w = 0.6 * 0.022 * low
            kick.h = -0.6 * 0.022 * low
            kick.hand = 1
            kick.light = -0.1 * low
        case .retry:
            let lift = there(s, 0.25, gesture, gesture) / retry
            kick.y = -0.02 * lift
            kick.w = 0.06 * lift
            kick.hand = 1
            kick.light = 0.05 * lift
        }
        return kick
    }

    /// The three drops at one instant: centre and half-extent tensor, and where each travels.
    private struct Layout {
        var shape: [(x: Double, y: Double, xx: Double, xy: Double, yy: Double)]
        var travel: [(x: Double, y: Double)]
        var kick: Kick
        var scene: Scene
    }

    /// Places the three drops at time `t`, with the blends moved on by their rates for `ahead` seconds.
    private static func layout(_ t: Double, ahead: Double, weights: [Double], rates: [Double], input: Input, scene base: Scene) -> Layout {
        var scene = base
        scene.t = t
        idleGesture(t, scene.seed, into: &scene)
        waitingCycle(t - (input.asked ?? 0), into: &scene)
        share(&scene)
        let kick = pulseAt(input.pulse, t)
        let gate = scene.gate
        let moved = (0..<18).map { weights[$0] + rates[$0] * ahead }
        let since = input.changed.map { t - $0 } ?? -1
        let flat = clamp((moved[5] + moved[11] + moved[17]) / 3)
        let ready = 0.022 * gate * (1 - flat) * bump(since, 0, 0.24)

        var shape: [(x: Double, y: Double, xx: Double, xy: Double, yy: Double)] = []
        var travel: [(x: Double, y: Double)] = []
        for k in 0..<3 {
            var x = 0.0, y = 0.0, xx = 0.0, xy = 0.0, yy = 0.0
            var spots = [Double](repeating: 0, count: 12)
            for s in 0..<6 {
                let w = moved[k * 6 + s]
                if w == 0 { continue }
                let p = pose(State(rawValue: s)!, k, scene)
                spots[2 * s] = p.x
                spots[2 * s + 1] = p.y
                let a = p.w / 2, b = p.h / 2, c = cos(p.angle), n = sin(p.angle)
                x += w * p.x
                y += w * p.y
                xx += w * (a * c * c + b * n * n)
                xy += w * (a - b) * n * c
                yy += w * (a * n * n + b * c * c)
            }
            // Between two states a drop travels along an arc, not a straight line.
            for s in 0..<6 {
                let ws = moved[k * 6 + s]
                if ws == 0 { continue }
                for r in (s + 1)..<6 {
                    let both = ws * moved[k * 6 + r] * arc[k] * scene.live
                    if both == 0 { continue }
                    x -= both * (spots[2 * r + 1] - spots[2 * s + 1])
                    y += both * (spots[2 * r] - spots[2 * s])
                }
            }
            travel.append((x, y))
            let share = k == 2 ? kick.hand : 1
            let motion = scene.live * gate * share
            y += motion * kick.y
            xx *= 1 + motion * kick.w + (k == 0 ? ready : 0)
            yy *= 1 + motion * kick.h - (k == 0 ? 1.3 * ready : 0)
            xy *= 1 + motion * 0.5 * (kick.w + kick.h)
            if k == 0 { y += 0.65 * ready * yy }
            shape.append((x, y, xx, xy, yy))
        }
        return Layout(shape: shape, travel: travel, kick: kick, scene: scene)
    }

    // MARK: The model

    /// The presence at one instant: a pure function of its input.
    static func frame(_ input: Input) -> Frame {
        let size = input.size, theme = input.theme, calm = input.calm, t = input.time
        let tiny = tininess(size)
        let level = clamp(input.level) * (calm ? 0.6 : 1)
        var scene = Scene()
        scene.level = level
        scene.slow = input.voice.map { clamp($0.slow) * (calm ? 0.6 : 1) } ?? level
        scene.tiny = tiny
        scene.calm = calm
        scene.live = calm ? 0 : 1
        scene.gate = calm ? 0 : 1 - smoothstep(0, 0.6, tiny)
        scene.seed = input.seed
        scene.lift = calm ? nil : input.voice?.lift

        let blends = input.blends.count == 3 ? input.blends : Array(repeating: input.blends[0], count: 3)
        var weights = [Double](repeating: 0, count: 18), rates = [Double](repeating: 0, count: 18)
        for k in 0..<3 {
            for s in 0..<6 {
                weights[k * 6 + s] = blends[k].weights[s]
                rates[k * 6 + s] = !calm ? input.velocity?[k].weights[s] ?? 0 : 0
            }
        }

        let soon = layout(t + step, ahead: step, weights: weights, rates: rates, input: input, scene: scene)
        let now = layout(t, ahead: 0, weights: weights, rates: rates, input: input, scene: scene)
        scene = now.scene

        let u = size / 2
        let least = min(2 / u, 0.2)
        var drops: [Pill] = []
        for k in 0..<3 {
            let vx = (soon.travel[k].x - now.travel[k].x) / step, vy = (soon.travel[k].y - now.travel[k].y) / step
            let v = length(vx, vy)
            let s = now.shape[k]
            let stretch = scene.live * (1 - 0.5 * tiny) * min(stretchMax, stretchGain * v)
            var p = s.xx * s.xx + s.xy * s.xy, q = s.xy * (s.xx + s.yy), r = s.yy * s.yy + s.xy * s.xy
            if stretch > 1e-6 {
                let f = 1 + stretch, g = 1 / f, nx = vx / v, ny = vy / v
                let m11 = g + (f - g) * nx * nx, m12 = (f - g) * nx * ny, m22 = g + (f - g) * ny * ny
                let a11 = m11 * p + m12 * q, a12 = m11 * q + m12 * r, a21 = m12 * p + m22 * q, a22 = m12 * q + m22 * r
                p = a11 * m11 + a12 * m12
                q = a11 * m12 + a12 * m22
                r = a21 * m12 + a22 * m22
            }
            let mean = (p + r) / 2, spread = length((p - r) / 2, q)
            var major = max(0, mean + spread).squareRoot(), minor = max(0, mean - spread).squareRoot()
            var angle = spread < 1e-12 ? 0 : 0.5 * atan2(2 * q, p - r)
            if abs(angle) > Double.pi / 4 {
                swap(&major, &minor)
                angle -= (angle > 0 ? 1 : -1) * (Double.pi / 2)
            }
            let w = clamp(2 * major, least, 2), h = clamp(2 * minor, least, 2)
            let radius = min(w, h) / 2, half = max(w, h) / 2 - radius
            let along = w >= h ? angle : angle + Double.pi / 2
            let bx = half * abs(cos(along)) + radius, by = half * abs(sin(along)) + radius
            drops.append(Pill(
                x: clamp(s.x, -1 + bx, 1 - bx) * u, y: clamp(s.y, -1 + by, 1 - by) * u,
                w: w * u, h: h * u, angle: abs(angle) < 1e-9 ? 0 : angle))
        }

        // Colours and light follow the tint — or the average blend — kept inside 0–1.
        var average = [Double](repeating: 0, count: 6)
        var total = 0.0, between = 0.0
        for s in 0..<6 {
            average[s] = clamp(input.tint?.weights[s] ?? (weights[s] + weights[6 + s] + weights[12 + s]) / 3)
            total += average[s]
        }
        for k in 0..<3 {
            var square = 0.0
            for s in 0..<6 { square += pow(weights[k * 6 + s], 2) }
            between = max(between, clamp(2 * (1 - square)))
        }
        for s in 0..<6 { average[s] = total > 0 ? average[s] / total : s == 0 ? 1 : 0 }
        var light = Light()
        let from = Palette.mix(average, theme, .from), to = Palette.mix(average, theme, .to), halo = Palette.mix(average, theme, .halo)
        light.core = Palette.mix(average, theme, .core)

        var glow = 0.0, energy = 0.0, wobble = 0.0, merge = 0.0, rim = 0.0
        for s in 0..<6 {
            let w = average[s]
            glow += w * Palette.look(theme, State(rawValue: s)!).glow
            energy += w * matter[s][0]
            wobble += w * matter[s][2]
            merge += w * matter[s][3]
            rim += w * matter[s][4]
        }
        let listen = average[3], speak = average[4], work = average[1], wait = average[2]
        energy += listen * 0.3 * level + speak * 0.5 * level
        wobble += speak * 0.004 * level
        merge += speak * 0.22 * smoothstep(0.4, 0.9, level)
        var crossing = 0.0
        for (i, j) in [(0, 1), (0, 2), (1, 2)] {
            let a = drops[i], b = drops[j]
            let gap = length(a.x - b.x, a.y - b.y) / u - (min(a.w, a.h) + min(b.w, b.h)) / (2 * u)
            crossing = max(crossing, 1 - smoothstep(-0.05, 0.12, gap))
        }
        merge += work * 0.05 * crossing
        energy += work * 0.08 * crossing
        merge *= 1 + 0.6 * between

        let wave = scene.waitU
        let swell = wait * scene.gate * scene.waitAmp * (wave > 0 ? (1 - exp(-wave / 0.12)) * exp(-max(0, wave - 0.4) / 0.8) : 0)
        let calmBreath = calm ? 0.03 * breathe(t, 5.6, scene.seed) : 0
        let flash = (1 - tiny) * now.kick.light
        let pixelsAlive = smoothstep(40, 56, size)

        // On a light surface the light inside is a pearly sheen on ink: there, it is all there is to show.
        light.energy = theme == .light ? 0.55 * clamp(energy) : clamp(energy * (1 + calmBreath) + flash)
        light.flow = input.flow ?? t * flowRate(blends, level: level)
        light.radial = speak - listen
        light.bloom = clamp((glow * (1 + 0.5 * level) + 0.08 * swell + flash) * (1 + 3 * calmBreath) * (1 - tiny))
        light.rim = rim * smoothstep(24, 40, size)
        light.wobble = wobble * scene.live * pixelsAlive * u
        light.merge = merge * u
        light.time = t

        let areas = drops.map { $0.w * $0.h }
        let whole = areas.reduce(0, +) > 0 ? areas.reduce(0, +) : 1
        let glows = drops.enumerated().map { k, drop in
            Glow(
                x: drop.x, y: drop.y,
                r: max(0, min(max(drop.w, drop.h) * 0.5 + 0.34 * u, 1.25 * u - length(drop.x, drop.y))),
                alpha: min(1, light.bloom * (0.4 + 0.6 * (areas[k] / whole))))
        }

        let bridges = [(0, 1), (0, 2), (1, 2)].map { i, j in
            let a = drops[i], b = drops[j]
            return bridge(a.x, a.y, min(a.w, a.h) / 2, b.x, b.y, min(b.w, b.h) / 2, gap: 0.5 * light.merge)
        }

        let big = drops[0]
        let hole = Pill(x: big.x, y: big.y, w: 0, h: 0)

        // On a light surface a ring of ink would only read as a grey halo: no ring there.
        if let voice = input.voice, !calm, tiny < 0.5, theme == .dark {
            let since = t - voice.onset, strength = clamp(voice.strength)
            if since >= 0, since < 0.6, listen > 0.01 {
                let outer = max(big.w, big.h) / 2
                let e = 1 - pow(1 - since / 0.6, 2)
                light.wave = [outer * (0.95 - 0.55 * e), 0.07 * u, listen * 0.16 * strength * pow(1 - since / 0.6, 1.5)]
            } else if since >= 0, since < 0.7, speak > 0.01 {
                let e = 1 - pow(1 - since / 0.7, 3)
                light.wave = [(0.55 + 0.6 * e) * u, 0.09 * u, speak * 0.07 * strength * pow(1 - since / 0.7, 2)]
            }
        }

        return Frame(size: size, drops: drops, bridges: bridges, hole: hole, glows: glows, from: from, to: to, halo: halo, light: light)
    }

    /// The presence for plain inputs: one blend per drop, the time, the voice level, the size.
    static func frame(blends: [Blend], time: Double, level: Double = 0, size: Double, theme: Theme = .dark, calm: Bool = false) -> Frame {
        frame(Input(blends: blends, time: time, level: level, size: size, theme: theme, calm: calm))
    }

    /// A still frame of one state, as drawn when nothing may move: for glyphs beside words.
    static func still(_ state: State, size: Double, theme: Theme = .dark) -> Frame {
        frame(Input(blends: Array(repeating: Blend(only: state), count: 3), time: 0, size: size, theme: theme, calm: true))
    }

    // MARK: The mark

    /// The mark: the three drops caught mid-juggle — the big and the middle one
    /// still joined, the small one free. A still frame for what cannot move.
    static func mark(size: Double, theme: Theme = .dark) -> Frame {
        let u = size / 2
        let tiny = tininess(size)
        let spots = [(-0.3, 0.2, 0.48), (0.36, -0.42, 0.3), (0.6, 0.42, 0.19)]
        let drops = spots.enumerated().map { k, spot in
            let pull = k == 1 ? 0.045 * tiny : 0
            let radius = spot.2 + (k == 2 ? 0.04 : 0) * tiny
            return Pill(x: (spot.0 - pull) * u, y: (spot.1 + pull) * u, w: 2 * radius * u, h: 2 * radius * u)
        }
        func join(_ a: Pill, _ b: Pill) -> [Double] { bridge(a.x, a.y, a.w / 2, b.x, b.y, b.w / 2) }
        let look = Palette.look(theme, .idle)
        var light = Light()
        light.core = look.core
        light.energy = 0.22
        light.bloom = look.glow * (1 - tiny) * 0.7
        light.rim = theme == .dark ? 0.6 : 0.48
        light.merge = 0.3 * u
        return Frame(
            size: size, drops: drops,
            bridges: [join(drops[0], drops[1]), join(drops[0], drops[2]), join(drops[1], drops[2])],
            hole: Pill(x: 0, y: 0, w: 0, h: 0),
            glows: drops.map { Glow(x: $0.x, y: $0.y, r: $0.w / 2 + 0.3 * u, alpha: look.glow * (1 - tiny) * 0.7) },
            from: look.from, to: look.to, halo: look.halo, light: light)
    }
}
