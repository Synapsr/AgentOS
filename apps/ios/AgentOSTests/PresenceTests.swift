import Foundation
import Testing
@testable import AgentOS

/// The Swift presence against the TypeScript one. `presence.json` holds
/// what `packages/presence` returns for a set of inputs
/// (`Scripts/export-presence-reference.mjs` writes it); the port must give
/// the same numbers.
@Suite struct PresenceTests {
    /// Far below what a screen can show, far above what two maths libraries disagree on.
    private let tolerance = 1e-6
    /// A membrane attaches where `acos` is at its steepest: there, a
    /// difference in the last bit moves a point by a hundred-thousandth of
    /// a point. A thousandth is still fifty times finer than a pixel.
    private let membraneTolerance = 1e-3

    @Test func statesAreInTheSameOrder() throws {
        #expect(Presence.State.allCases.map { "\($0)" } == (try reference()).states)
    }

    @Test func coloursAreTheTokens() {
        // A state shown alone is its own colour: the token, to the unit.
        let frame = Presence.frame(blends: [Presence.Blend(only: .working)], time: 1, size: 240)
        let look = Presence.Palette.look(.dark, .working)
        #expect(abs(frame.from.red - look.from.red) < 0.5 && abs(frame.from.green - look.from.green) < 0.5 && abs(frame.from.blue - look.from.blue) < 0.5)
        #expect(look.from == Presence.RGB(0x62A8FF))
    }

    @Test func framesMatchTheReference() throws {
        let cases = try reference().frames
        #expect(cases.count == 132)
        for (index, each) in cases.enumerated() {
            expect(Presence.frame(try input(each.input)), equals: each.frame, "frame \(index)")
        }
    }

    @Test func motionMatchesTheReference() throws {
        let steps = try reference().steps
        #expect(steps.count == 345)
        let names = Presence.State.allCases.map { "\($0)" }
        var motion = Presence.Motion(.idle, size: 0, seed: 5)
        for (index, step) in steps.enumerated() {
            let target = Presence.State(rawValue: try #require(names.firstIndex(of: step.state)))!
            if let kind = step.pulse { motion.pulse(try #require(Presence.PulseKind(rawValue: kind))) }
            motion.step(step.dt, towards: target, level: step.level, calm: step.calm, size: step.size)
            let after = step.after
            expect([motion.time, motion.level, motion.alpha, motion.flow, motion.changed, motion.asked], equal: [after.time, after.level, after.alpha, after.flow, after.changed, after.asked], "clock after step \(index)")
            expect([motion.size, motion.sizeVelocity], equal: [after.size, after.sizeVelocity], "size after step \(index)")
            expect(motion.blend.flatMap(\.weights), equal: after.blend.flatMap(\.self), "blend after step \(index)")
            expect(motion.velocity.flatMap(\.weights), equal: after.velocity.flatMap(\.self), "velocity after step \(index)")
            expect(motion.drag.flatMap(\.weights), equal: after.drag.flatMap(\.self), "drag after step \(index)")
            expect(motion.tint.weights, equal: after.tint, "tint after step \(index)")
            expect([motion.voice.slow] + motion.voice.lift + [motion.voice.onset, motion.voice.strength], equal: after.voice, "voice after step \(index)")
            #expect(motion.settled == after.settled, "settled after step \(index)")
            #expect(motion.state == target)
            expect(Presence.frame(motion.input(size: step.size, calm: step.calm)), equals: after.frame, "frame after step \(index)")
        }
    }

    @Test func membranesMatchTheReference() throws {
        let cases = try reference().bridges
        #expect(cases.count == 28)
        for (index, each) in cases.enumerated() {
            let a = each.args
            expect(Presence.bridge(a[0], a[1], a[2], a[3], a[4], a[5]), equal: each.points, within: membraneTolerance, "bridge \(index)")
        }
    }

    @Test func theMarkMatchesTheReference() throws {
        for each in try reference().marks {
            let theme = try #require(Presence.Theme(rawValue: each.theme))
            expect(Presence.mark(size: each.size, theme: theme), equals: each.frame, "mark at \(each.size)")
        }
    }

    @Test func aChangeOfStateSettlesWithinASecond() {
        var motion = Presence.Motion(.idle)
        for _ in 0..<60 { motion.step(1.0 / 60, towards: .waiting) }
        #expect(abs(motion.blend[0][.waiting] - 1) < 0.002)
        // The same path at another frame rate.
        var slower = Presence.Motion(.idle)
        for _ in 0..<30 { slower.step(1.0 / 30, towards: .waiting) }
        expect(slower.blend.flatMap(\.weights), equal: motion.blend.flatMap(\.weights), "30 and 60 frames a second")
    }

    @Test func aChangeOfSizeIsAMovement() {
        var motion = Presence.Motion(.idle)
        motion.step(1.0 / 60, towards: .idle, size: 240)
        #expect(motion.size == 240)
        motion.step(1.0 / 60, towards: .idle, size: 96)
        #expect(motion.size < 240 && motion.size > 96)
        for _ in 0..<60 { motion.step(1.0 / 60, towards: .idle, size: 96) }
        #expect(motion.size == 96)
        // With Reduce Motion there is no travel.
        motion.step(1.0 / 60, towards: .idle, calm: true, size: 240)
        #expect(motion.size == 240)
    }

    @Test func offlineAtRestNeedsNoFrames() {
        var motion = Presence.Motion(.offline, size: 120)
        for _ in 0..<120 { motion.step(1.0 / 60, towards: .offline, size: 120) }
        #expect(motion.pace() == 0)
        motion.pulse(.retry)
        #expect(motion.pace() == 60)
    }

    // MARK: Helpers

    private func input(_ i: Reference.Case.Input) throws -> Presence.Input {
        var input = Presence.Input(
            blends: i.blends.map(Presence.Blend.init(weights:)), time: i.time, level: i.level, size: i.size,
            theme: try #require(Presence.Theme(rawValue: i.theme)), calm: i.calm)
        input.seed = i.seed
        input.changed = i.changed
        input.asked = i.asked
        input.velocity = i.velocity?.map(Presence.Blend.init(weights:))
        input.tint = i.tint.map(Presence.Blend.init(weights:))
        input.voice = i.voice.map { Presence.Voice(slow: $0.slow, lift: $0.lift, onset: $0.onset, strength: $0.strength) }
        input.pulse = try i.pulse.map { Presence.Pulse(kind: try #require(Presence.PulseKind(rawValue: $0.kind)), at: $0.at) }
        input.flow = i.flow
        return input
    }

    private func expect(_ frame: Presence.Frame, equals expected: Reference.Numbers, _ what: String) {
        expect(frame.drops.flatMap { [$0.x, $0.y, $0.w, $0.h, $0.angle] }, equal: expected.drops.flatMap(\.self), "drops of \(what)")
        expect(frame.bridges.flatMap(\.self), equal: expected.bridges.flatMap(\.self), within: membraneTolerance, "bridges of \(what)")
        expect(frame.glows.flatMap { [$0.x, $0.y, $0.r, $0.alpha] }, equal: expected.glows.flatMap(\.self), "glows of \(what)")
        let colours = [frame.from, frame.to, frame.halo, frame.light.core].flatMap { [$0.red, $0.green, $0.blue] }
        expect(colours, equal: expected.colours, "colours of \(what)")
        let light = frame.light
        expect([light.energy, light.flow, light.radial, light.bloom, light.rim, light.wobble, light.merge] + light.wave + [light.time], equal: expected.light, "light of \(what)")
    }

    private func expect(_ numbers: [Double], equal expected: [Double], within tolerance: Double? = nil, _ what: String) {
        let tolerance = tolerance ?? self.tolerance
        guard numbers.count == expected.count else {
            Issue.record("\(what): \(numbers.count) numbers instead of \(expected.count)")
            return
        }
        for (index, pair) in zip(numbers, expected).enumerated() where abs(pair.0 - pair.1) > tolerance * max(1, abs(pair.1)) {
            Issue.record("\(what): number \(index) is \(pair.0), the reference says \(pair.1)")
            return
        }
    }

    private func reference() throws -> Reference {
        try JSONDecoder().decode(Reference.self, from: try Fixture.data("presence.json"))
    }

    private struct Reference: Decodable {
        struct Numbers: Decodable {
            let drops, bridges, glows: [[Double]]
            let colours, light: [Double]
        }

        struct Case: Decodable {
            struct Input: Decodable {
                struct Voice: Decodable {
                    let slow, onset, strength: Double
                    let lift: [Double]
                }

                struct Pulse: Decodable {
                    let kind: String
                    let at: Double
                }

                let blends: [[Double]]
                let time, level, size: Double
                let theme: String
                let calm: Bool
                let seed: Int
                let changed, asked, flow: Double?
                let velocity: [[Double]]?
                let tint: [Double]?
                let voice: Voice?
                let pulse: Pulse?
            }

            let input: Input
            let frame: Numbers
        }

        struct Step: Decodable {
            struct After: Decodable {
                let time, level, alpha, size, sizeVelocity, flow, changed, asked: Double
                let settled: Bool
                let blend, velocity, drag: [[Double]]
                let tint, voice: [Double]
                let frame: Numbers
            }

            let dt, level, size: Double
            let state: String
            let calm: Bool
            let pulse: String?
            let after: After
        }

        struct Membrane: Decodable {
            let args, points: [Double]
        }

        struct Mark: Decodable {
            let size: Double
            let theme: String
            let frame: Numbers
        }

        let states: [String]
        let frames: [Case]
        let steps: [Step]
        let bridges: [Membrane]
        let marks: [Mark]
    }
}
