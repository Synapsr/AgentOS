import Foundation

extension Presence {
    /// The presence in time: what turns "the agent is now waiting" into a
    /// blend that moves. A port of `packages/presence/src/motion.ts`.
    ///
    /// Each drop follows the target state on its own spring — the small one
    /// quick and bouncy, the big one heavy — and each kind of change has its
    /// own feel: a deflate into offline, a wake out of it, a pop when it asks,
    /// a slow lowered hand after "stop". Before it moves, the body gathers
    /// itself for a moment. Colour follows on the design system's `material`
    /// spring. The voice is followed three ways: a level, a slow level, and
    /// onsets that throw the speaking drops up. Plain arithmetic, solved
    /// exactly: any `dt` gives the same path.
    struct Motion: Equatable, Sendable {
        /// A spring as its perceptual duration and its bounce.
        typealias Feel = (duration: Double, bounce: Double)

        private static let gesture: Feel = (Tokens.Motion.gesture.duration, Tokens.Motion.gesture.bounce)
        /// Springs of each drop — big, middle, small — for each kind of change.
        private static let change: [Feel] = [(0.62, 0.15), gesture, (0.42, 0.4)]
        private static let ask: [Feel] = [(0.62, 0.15), gesture, (0.4, 0.45)]
        private static let deflate: [Feel] = [(0.9, 0), (0.8, 0), (0.7, 0)]
        private static let wake: [Feel] = [(0.6, 0.2), (0.55, 0.3), (0.48, 0.35)]
        private static let lower: [Feel] = [(0.62, 0.1), (0.55, 0.1), (0.7, 0)]

        private static func omega(_ feel: Feel) -> Double { 2 * Double.pi / feel.duration }
        private static func zeta(_ feel: Feel) -> Double { 1 - feel.bounce }

        /// Spring of each drop for an ordinary change — big, middle, small: angular frequency in rad/s, damping ratio.
        static let springs = change.map { (omega($0), zeta($0)) }
        /// How fast the level follows the voice, per second: rising, then falling.
        static let attack = 24.0
        static let release = 8.0
        private static let slowRate = 2.0, trailRate = 3.0
        /// Onsets closer together than this are one syllable.
        private static let syllable = 0.14
        /// In calm mode a change of state is a short fade through nothing: the design system's `exit`.
        static let calmFade = Tokens.Motion.exit
        /// How fast a change of size settles: the design system's `layout` spring, in rad/s.
        static let sizeSpring = 2 * Double.pi / Tokens.Motion.layout.duration
        private static let material: Feel = (Tokens.Motion.material.duration, Tokens.Motion.material.bounce)
        private static let anticipation = 0.08
        private static let gather = 0.24
        private static let drag = 0.06
        private static let pulseLength = 2.5
        /// The speaking drops: how high each lifts with the voice, how high a syllable throws it, when, and its spring.
        private static let bounceReach = [0.1, 0.07, 0.07]
        private static let bounceThrow = [0.26, 0.2, 0.2]
        private static let bounceDelay = [0, 0.07, 0.12]
        private static let bounceFeel: [Feel] = [(0.3, 0.55), (0.34, 0.5), (0.32, 0.5)]
        private static let throwTime = 0.14

        /// Seconds since creation.
        var time = 0.0
        /// The state being moved towards, and the one before it.
        var state: State
        var from: State
        /// When the last change began: the body gathers itself for a moment after it.
        var changed = -1.0
        /// When waiting last began: it times the waiting wave and its patience.
        var asked = 0.0
        /// Smoothed voice level, 0–1.
        var level = 0.0
        /// The voice followed in time.
        var voice = Voice()
        var liftVelocity = [0.0, 0.0, 0.0]
        /// The level followed more slowly, to find where syllables start; and the onset signal at the last step.
        var trail = 0.0
        var rising = 0.0
        /// How much of each state's colour and light shows, on the `material` spring.
        var tint: Blend
        var tintVelocity: Blend
        /// Blend of each drop: big, middle, small.
        var blend: [Blend]
        /// Rate of change of each blend.
        var velocity: [Blend]
        /// The rates as the drops feel them, a moment late: what they stretch with.
        var drag: [Blend]
        /// The spring each drop is on for the change under way.
        var spring: [Double]
        /// How far the inner light has flowed, in stage units.
        var flow = 0.0
        /// The last pulse, if any.
        var pulse: Pulse?
        /// Picks the sequence of small idle gestures.
        var seed: Int
        /// Opacity of the whole figure; dips only for calm-mode changes.
        var alpha = 1.0
        /// Side of the stage in points, eased towards the size asked for. 0 until one is given.
        var size: Double
        /// Rate of change of the size, in points per second.
        var sizeVelocity = 0.0
        /// True once nothing is changing any more except the ambient motion of the state itself.
        var settled = true

        /// A presence at rest in `state`, on a stage of `size` points if it is known already.
        init(_ state: State = .idle, size: Double = 0, seed: Int = 0) {
            self.state = state
            from = state
            self.size = size
            self.seed = seed
            tint = Blend(only: state)
            tintVelocity = Blend(only: state, weight: 0)
            blend = Array(repeating: Blend(only: state), count: 3)
            velocity = Array(repeating: Blend(only: state, weight: 0), count: 3)
            drag = Array(repeating: Blend(only: state, weight: 0), count: 3)
            spring = Self.springs.flatMap { [$0.0, $0.1] }
        }

        /// The exact solution of a damped spring over dt, from (x, v) relative to its rest.
        private static func solve(_ x: Double, _ v: Double, _ w: Double, _ z: Double, _ dt: Double) -> (Double, Double) {
            if z < 1 {
                let decay = exp(-z * w * dt)
                let wd = w * (1 - z * z).squareRoot()
                let cosine = cos(wd * dt), sine = sin(wd * dt)
                let c = (v + z * w * x) / wd
                return (decay * (x * cosine + c * sine), decay * (v * cosine - (x * wd + c * z * w) * sine))
            }
            let decay = exp(-w * dt)
            let c = v + w * x
            return ((x + c * dt) * decay, (c - w * (x + c * dt)) * decay)
        }

        /// Advances by `dt` seconds towards `target`, hearing the raw voice `level` (0–1). A change of `size` is eased too.
        mutating func step(_ dt: Double, towards target: State, level raw: Double = 0, calm: Bool = false, size: Double? = nil) {
            let start = time
            time += dt
            let voiced = target == .listening || target == .speaking
            let heard = voiced ? min(1, max(0, raw)) : 0
            level += (heard - level) * (1 - exp(-dt * (heard > level ? Self.attack : Self.release)))
            let quiet = stepVoice(speaking: target == .speaking, calm: calm, dt)
            let sized = stepSize(dt, towards: size, calm: calm)

            if target != state {
                from = state
                state = target
                if target == .waiting { asked = start }
                // A body already gathering itself does not start again; a dash has nothing to gather.
                if start - changed >= Self.gather, target != .offline, from != .offline { changed = start }
                if !calm { feel(from: from, to: target) }
            }
            if calm { return stepCalm(dt, towards: target) }

            alpha = min(1, alpha + dt / Self.calmFade)
            flow += Presence.flowRate(blend, level: level) * dt
            // The drops keep their course while the body gathers itself, then turn to the new state.
            let gathers = state != .offline && from != .offline
            let wait = gathers ? min(dt, max(0, changed + Self.anticipation - start)) : 0
            if wait > 0 { _ = stepBlends(towards: from, wait) }
            let moving = max(stepBlends(towards: state, dt - wait), stepTint(towards: state, dt))
            let follow = 1 - exp(-dt / Self.drag)
            for k in 0..<3 {
                for s in 0..<6 { drag[k].weights[s] += (velocity[k].weights[s] - drag[k].weights[s]) * follow }
            }
            let pulsing = pulse.map { time - $0.at < Self.pulseLength } ?? false
            settled = moving < 0.002 && sized && quiet && !pulsing
        }

        private mutating func stepBlends(towards target: State, _ dt: Double) -> Double {
            var moving = 0.0
            for k in 0..<3 {
                let w = spring[2 * k], z = spring[2 * k + 1]
                for s in 0..<6 {
                    let goal: Double = s == target.rawValue ? 1 : 0
                    if dt > 0 {
                        let (x, v) = Self.solve(blend[k].weights[s] - goal, velocity[k].weights[s], w, z, dt)
                        blend[k].weights[s] = goal + x
                        velocity[k].weights[s] = v
                    }
                    moving = max(moving, abs(blend[k].weights[s] - goal), abs(velocity[k].weights[s]) * 0.05)
                }
            }
            return moving
        }

        private mutating func stepTint(towards target: State, _ dt: Double) -> Double {
            var moving = 0.0
            for s in 0..<6 {
                let goal: Double = s == target.rawValue ? 1 : 0
                let (x, v) = Self.solve(tint.weights[s] - goal, tintVelocity.weights[s], Self.omega(Self.material), Self.zeta(Self.material), dt)
                tint.weights[s] = goal + x
                tintVelocity.weights[s] = v
                moving = max(moving, abs(x), abs(v) * 0.05)
            }
            return moving
        }

        /// Follows the voice: the slow level, onsets, and the speaking drops on their springs. True once the drops are at rest.
        private mutating func stepVoice(speaking: Bool, calm: Bool, _ dt: Double) -> Bool {
            voice.slow += (level - voice.slow) * (1 - exp(-dt * Self.slowRate))
            trail += (level - trail) * (1 - exp(-dt * Self.trailRate))
            let onset = min(1, max(0, (level - trail - 0.05) * 5))
            if onset >= 0.35, rising < 0.35, time - voice.onset >= Self.syllable {
                voice.onset = time
                voice.strength = onset
            }
            rising = onset
            var resting = true
            for k in 0..<3 {
                var goal = speaking ? Self.bounceReach[k] * level * (0.6 + 0.4 * sin(time * (k == 0 ? 9 : 7.3) + Double(k) * 2.4)) : 0
                let thrown = time - voice.onset - Self.bounceDelay[k]
                if speaking, !calm, thrown > 0, thrown < Self.throwTime {
                    goal += Self.bounceThrow[k] * voice.strength * pow(sin(Double.pi * thrown / Self.throwTime), 2)
                }
                let feel = Self.bounceFeel[k]
                let (x, v) = Self.solve(voice.lift[k] - goal, liftVelocity[k], Self.omega(feel), Self.zeta(feel), dt)
                voice.lift[k] = max(-0.1, goal + x)
                liftVelocity[k] = v
                if abs(x) > 0.002 || abs(v) > 0.04 { resting = false }
            }
            return resting
        }

        /// Eases the stage towards `target`. True once it is there.
        private mutating func stepSize(_ dt: Double, towards target: Double?, calm: Bool) -> Bool {
            guard let target else { return true }
            if size == 0 || calm {
                size = target
                sizeVelocity = 0
                return true
            }
            let x = size - target
            let c = sizeVelocity + Self.sizeSpring * x
            let decay = exp(-Self.sizeSpring * dt)
            size = target + (x + c * dt) * decay
            sizeVelocity = (c - Self.sizeSpring * (x + c * dt)) * decay
            if abs(size - target) >= 0.25 || abs(sizeVelocity) >= 4 { return false }
            size = target
            sizeVelocity = 0
            return true
        }

        /// Calm mode: no morph. The figure fades out, changes, and fades back in.
        private mutating func stepCalm(_ dt: Double, towards target: State) {
            let shown = blend[0][target] == 1
            alpha = shown ? min(1, alpha + dt / Self.calmFade) : max(0, alpha - dt / Self.calmFade)
            if !shown, alpha == 0 {
                blend = Array(repeating: Blend(only: target), count: 3)
                velocity = Array(repeating: Blend(only: target, weight: 0), count: 3)
                drag = velocity
                tint = Blend(only: target)
                tintVelocity = Blend(only: target, weight: 0)
            }
            settled = shown && alpha == 1
        }

        /// Picks each drop's spring for a change from `from` to `to`.
        private mutating func feel(from: State, to: State) {
            let stopped = pulse.map { $0.kind == .denied && time - $0.at < 1.5 } ?? false
            let feels = to == .offline ? Self.deflate : from == .offline ? Self.wake : stopped ? Self.lower : to == .waiting ? Self.ask : Self.change
            spring = feels.flatMap { [Self.omega($0), Self.zeta($0)] }
        }

        /// Tells it something really happened: "approved" (a nod), "denied" (the hand lowered), "retry" (offline, one lift).
        mutating func pulse(_ kind: PulseKind) {
            pulse = Pulse(kind: kind, at: time)
            settled = false
            // A "stop" lowers the hand slowly even if the change of state came first.
            if kind == .denied { feel(from: from, to: state) }
        }

        /// How many frames a second this needs right now: 60 while something travels, 30 at rest, 15 for calm mode's breath of light, 0 when nothing can change.
        func pace(calm: Bool = false) -> Double {
            let pulsing = pulse.map { time - $0.at < Self.pulseLength } ?? false
            if calm { return alpha < 1 || !settled ? 60 : state == .offline && !pulsing ? 0 : 15 }
            if !settled || pulsing { return 60 }
            switch state {
            case .offline: return 0
            case .working: return 60
            case .listening, .speaking: return level > 0.01 || voice.slow > 0.02 ? 60 : 30
            default: return Presence.gesturing(state, time: time, asked: asked, seed: seed) ? 60 : 30
            }
        }

        /// The model's input right now, on the stage this motion is easing.
        func input(size: Double? = nil, theme: Theme = .dark, calm: Bool = false) -> Input {
            Input(
                blends: blend, time: time, level: level, size: size ?? self.size, theme: theme, calm: calm,
                changed: changed, asked: asked, velocity: drag, tint: tint, voice: voice, pulse: pulse, flow: flow, seed: seed)
        }

        /// The frame to draw right now.
        func frame(theme: Theme = .dark, calm: Bool = false) -> Frame {
            Presence.frame(input(theme: theme, calm: calm))
        }

        static func == (a: Motion, b: Motion) -> Bool {
            a.time == b.time && a.state == b.state && a.blend == b.blend && a.velocity == b.velocity && a.tint == b.tint
                && a.voice == b.voice && a.size == b.size && a.alpha == b.alpha && a.pulse == b.pulse
        }
    }
}
