import SwiftUI

/// Something that really happened, for the presence to answer with its
/// body: "approved" (it nods), "denied" (it lowers its hand), "retry"
/// (offline, it lifts once). Each new value is played once.
struct PresencePulse: Equatable, Sendable {
    let kind: Presence.PulseKind
    let id = UUID()

    init(_ kind: Presence.PulseKind) {
        self.kind = kind
    }
}

/// The agent's presence, alive: three drops of light that behave as one
/// liquid body (docs/PRESENCE.md). It is the only brand element, the same at
/// every size, and always shown with words — the shape is never the only way
/// to know what the agent is doing.
///
/// The look comes from `Presence.frame`, the movement from `Presence.Motion`;
/// `PresencePaths` draws it in a `Canvas`, on the iPhone and the watch alike —
/// with the light inside the body on the iPhone, a lighter version on the
/// watch. It draws only as often as what it shows needs: 60 frames a second
/// while something travels, 30 at rest, 15 for Reduce Motion's breath of
/// light, none when nothing can change or when the app is not in front.
struct PresenceView: View {
    var state: Presence.State
    /// Side of the stage in points: the square the figure moves in. The body
    /// at rest fills half of it; the light reaches a quarter beyond its edge,
    /// without taking room in the layout. A change of size is a movement.
    var size: CGFloat
    /// The raw voice level, 0–1, asked for at every frame: the microphone
    /// while listening, the agent's voice while speaking.
    var level: @MainActor () -> Double = { 0 }
    /// Frames a second at most. The watch asks for 30.
    var rate = 60.0
    /// The display is dimmed (Always On): hold a calm frame.
    var isDimmed = false
    /// Light on black, or a black pearl on a light surface. `nil` follows the
    /// colour scheme; OS mode and the watch are always dark.
    var appearance: Presence.Theme?
    /// The last answer or reconnection attempt, played once when it changes.
    var pulse: PresencePulse?
    /// Picks the sequence of small idle gestures, so that two presences do not move in step.
    var seed = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @State private var clock = Clock()
    @State private var pace = 60.0

    var body: some View {
        // Reduce Motion is the model's `calm`: the shapes stay, the travel goes.
        let calm = reduceMotion || isDimmed
        let theme = appearance ?? (colorScheme == .dark ? .dark : .light)
        let fps = min(rate, pace)
        // Nothing to draw while nothing can change, the display is dimmed, or the app is not in front.
        let paused = fps == 0 || isDimmed || scenePhase != .active
        TimelineView(.animation(minimumInterval: 1 / max(fps, 1), paused: paused)) { timeline in
            let motion = clock.advance(to: timeline.date, towards: state, level: level(), calm: calm, size: size)
            let frame = motion.frame(theme: theme, calm: calm)
            let side = motion.size * 1.25
            Canvas { context, canvas in
                PresencePaths.draw(frame, opacity: motion.alpha, rich: Self.rich, onBlack: theme == .dark, in: &context, size: canvas)
            }
                .frame(width: side, height: side)
                .frame(width: motion.size, height: motion.size)
                .onChange(of: motion.pace(calm: calm), initial: true) { _, pace in self.pace = pace }
        }
        .onChange(of: state) { pace = 60 }
        .onChange(of: calm) { pace = 60 }
        .onChange(of: size) { pace = 60 }
        .onChange(of: pulse) { _, pulse in
            guard let pulse else { return }
            clock.pulse(pulse.kind)
            pace = 60
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// The iPhone draws the light inside the body; the watch a lighter version, for its battery.
    #if os(watchOS)
    private static let rich = false
    #else
    private static let rich = true
    #endif

    /// The motion, kept between frames. The first state shown is shown at rest.
    @MainActor
    private final class Clock {
        private var motion: Presence.Motion?
        private var last: Date?
        private var pending: Presence.PulseKind?

        func advance(to date: Date, towards state: Presence.State, level: Double, calm: Bool, size: Double) -> Presence.Motion {
            var motion = self.motion ?? Presence.Motion(state, size: size)
            // Never jump over the time spent paused or out of sight.
            let dt = last.map { min(max(date.timeIntervalSince($0), 0), 0.05) } ?? 0
            motion.step(dt, towards: state, level: level, calm: calm, size: size)
            if let pending {
                motion.pulse(pending)
                self.pending = nil
            }
            self.motion = motion
            last = date
            return motion
        }

        func pulse(_ kind: Presence.PulseKind) {
            pending = kind
        }
    }
}

/// A state of the presence, still: its own shape and colours, frozen, for the
/// places that show a state beside words — "Nova is asking", a chip.
struct PresenceGlyph: View {
    var state: Presence.State
    var size: CGFloat = Tokens.Stage.label

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let frame = Presence.still(state, size: size, theme: colorScheme == .dark ? .dark : .light)
        Canvas { context, canvas in
            PresencePaths.draw(frame, onBlack: colorScheme == .dark, in: &context, size: canvas)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The mark: one still frame of the presence, for what cannot move — a
/// complication, a glyph next to a name.
struct PresenceMark: View {
    var size: CGFloat

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let frame = Presence.mark(size: size, theme: colorScheme == .dark ? .dark : .light)
        Canvas { context, canvas in
            PresencePaths.draw(frame, onBlack: colorScheme == .dark, in: &context, size: canvas)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The path renderer: `paint` in `packages/presence/src/canvas.ts`, made
/// as close to the web's light as SwiftUI allows without a shader. Three
/// pills and their membranes in the stage's gradient; around them a glow;
/// inside each outer drop, layered light — deeper towards the rim, a broad
/// soft light drifting slowly with the flow, a crescent of light inside the
/// top edge, and, while listening or speaking, soft rings that travel in or
/// out. Nothing in it is a thin line. The watch gets a lighter version.
enum PresencePaths {
    /// Draws one frame centred in `size`. `rich` adds what the watch goes without: a shaped glow, drifting light, rings.
    /// `onBlack` is false for the black pearl on a light surface, where light cannot be added, only shown.
    static func draw(_ frame: Presence.Frame, opacity: Double = 1, rich: Bool = true, onBlack: Bool = true, in context: inout GraphicsContext, size: CGSize) {
        let u = frame.size / 2, light = frame.light
        context.translateBy(x: size.width / 2, y: size.height / 2)
        context.opacity = opacity

        var body = Path()
        for drop in frame.drops { body.addPath(path(of: drop)) }
        let membranes = frame.bridges.filter { abs($0[0] - $0[14]) + abs($0[1] - $0[15]) >= 0.01 }.map(path(ofBridge:))
        let halo = Color(frame.halo)

        // The glow: the body's own shape, blurred, where it can be afforded; soft discs on the watch.
        if light.bloom > 0.004, u > 14 {
            if rich {
                context.drawLayer { glow in
                    glow.addFilter(.blur(radius: 0.18 * u))
                    glow.opacity = min(1, light.bloom * 1.6)
                    glow.fill(body, with: .color(halo))
                    for membrane in membranes { glow.fill(membrane, with: .color(halo)) }
                }
            } else {
                for glow in frame.glows where glow.alpha > 0.004 && glow.r > 0 {
                    context.fill(
                        Path(ellipseIn: CGRect(x: glow.x - glow.r, y: glow.y - glow.r, width: 2 * glow.r, height: 2 * glow.r)),
                        with: .radialGradient(
                            Gradient(stops: [
                                .init(color: halo.opacity(glow.alpha), location: 0),
                                .init(color: halo.opacity(glow.alpha * 0.32), location: 0.45),
                                .init(color: halo.opacity(0), location: 1),
                            ]),
                            center: CGPoint(x: glow.x, y: glow.y), startRadius: 0, endRadius: glow.r))
                }
            }
        }

        // One gradient across the stage: the drops change colour as they travel through it.
        let shading = GraphicsContext.Shading.linearGradient(
            Gradient(colors: [Color(frame.from), Color(frame.to)]),
            startPoint: CGPoint(x: -0.6 * u, y: -0.7 * u), endPoint: CGPoint(x: 0.6 * u, y: 0.7 * u))
        context.fill(body, with: shading)
        for membrane in membranes { context.fill(membrane, with: shading) }

        guard u > 20 else { return }
        let core = Color(light.core)
        // The flow and the clock, as slow phases: where the inner light has drifted to.
        let drift = (x: sin(3 * light.flow + 0.5 * light.time), y: cos(2.1 * light.flow + 0.4 * light.time))
        for drop in frame.drops {
            let inside = frame.drops.contains { other in other != drop && other.w * other.h > drop.w * drop.h && contains(other, drop.x, drop.y) }
            if inside { continue }
            context.drawLayer { layer in
                layer.clip(to: path(of: drop))
                let r = max(drop.w, drop.h) / 2, across = min(drop.w, drop.h) / 2
                // Deeper towards the rim: volume.
                layer.fill(
                    disc(drop.x, drop.y, r),
                    with: .radialGradient(
                        Gradient(colors: [.black.opacity(0), .black.opacity((onBlack ? 0.18 : 0.1) * min(1, light.energy * 3))]),
                        center: CGPoint(x: drop.x, y: drop.y), startRadius: 0.5 * across, endRadius: r))
                guard light.energy > 0.02 else { return }
                // The heart: a broad soft light, a touch up and to the left, drifting slowly with the flow.
                if onBlack { layer.blendMode = .plusLighter }
                let heart = CGPoint(x: drop.x + r * (-0.18 + (rich ? 0.16 * drift.x : 0)), y: drop.y + r * (-0.22 + (rich ? 0.13 * drift.y : 0)))
                layer.fill(
                    disc(heart.x, heart.y, 1.1 * r),
                    with: .radialGradient(
                        Gradient(colors: [core.opacity(0.42 * light.energy), core.opacity(0)]),
                        center: heart, startRadius: 0, endRadius: 1.1 * r))
                if rich {
                    // A second, fainter pool of light on the other side, drifting the other way: the body is never flat.
                    let pool = CGPoint(x: drop.x + r * (0.22 - 0.1 * drift.y), y: drop.y + r * (0.2 + 0.08 * drift.x))
                    layer.fill(
                        disc(pool.x, pool.y, 0.8 * r),
                        with: .radialGradient(
                            Gradient(colors: [core.opacity(0.16 * light.energy), core.opacity(0)]),
                            center: pool, startRadius: 0, endRadius: 0.8 * r))
                    // Listening, soft rings travel in; speaking, out. They fade before the heart: never a dot.
                    let rings = abs(light.radial)
                    if rings > 0.05, drop == frame.drops[0] {
                        let phase = (9 * light.flow / (2 * Double.pi)).truncatingRemainder(dividingBy: 1)
                        for n in 0..<2 {
                            var at = (phase + Double(n) / 2).truncatingRemainder(dividingBy: 1)
                            if light.radial < 0 { at = 1 - at }
                            let radius = r * (0.35 + 0.65 * at)
                            let strength = 0.14 * rings * light.energy * sin(Double.pi * at)
                            layer.fill(
                                disc(drop.x, drop.y, radius + 0.12 * r),
                                with: .radialGradient(
                                    Gradient(stops: [
                                        .init(color: core.opacity(0), location: 0),
                                        .init(color: core.opacity(0), location: max(0, (radius - 0.12 * r) / (radius + 0.12 * r))),
                                        .init(color: core.opacity(strength), location: radius / (radius + 0.12 * r)),
                                        .init(color: core.opacity(0), location: 1),
                                    ]),
                                    center: CGPoint(x: drop.x, y: drop.y), startRadius: 0, endRadius: radius + 0.12 * r))
                        }
                    }
                }
                layer.blendMode = .normal
                // A crescent of light just inside the top edge: lit from above, not glossy.
                if light.rim > 0.02, across > 6 {
                    var gloss = layer
                    gloss.translateBy(x: drop.x - 0.22 * across, y: drop.y - 0.62 * across)
                    gloss.scaleBy(x: 1, y: 0.45)
                    gloss.fill(
                        disc(0, 0, 0.55 * across),
                        with: .radialGradient(
                            Gradient(colors: [.white.opacity(0.3 * light.rim), .white.opacity(0)]),
                            center: .zero, startRadius: 0, endRadius: 0.55 * across))
                }
            }
        }

        // A syllable's ring of light, soft, on the iPhone.
        if rich, light.wave[2] > 0.005 {
            let radius = light.wave[0], width = max(1, light.wave[1])
            context.drawLayer { ring in
                ring.addFilter(.blur(radius: width / 2))
                ring.stroke(disc(0 + frame.drops[0].x, frame.drops[0].y, radius), with: .color(core.opacity(min(1, 2 * light.wave[2]))), lineWidth: width)
            }
        }
    }

    private static func disc(_ x: Double, _ y: Double, _ r: Double) -> Path {
        Path(ellipseIn: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
    }

    /// A pill as a path, turned by its angle about its centre.
    static func path(of pill: Presence.Pill) -> Path {
        let rect = CGRect(x: -pill.w / 2, y: -pill.h / 2, width: pill.w, height: pill.h)
        let shape = Path(roundedRect: rect, cornerRadius: min(pill.w, pill.h) / 2, style: .circular)
        return shape.applying(CGAffineTransform(rotationAngle: pill.angle).concatenating(CGAffineTransform(translationX: pill.x, y: pill.y)))
    }

    /// True if (x, y) is inside `pill`.
    private static func contains(_ pill: Presence.Pill, _ x: Double, _ y: Double) -> Bool {
        let radius = min(pill.w, pill.h) / 2, half = max(pill.w, pill.h) / 2 - radius
        let along = pill.angle + (pill.w >= pill.h ? 0 : Double.pi / 2)
        let c = cos(along), s = sin(along)
        var qx = c * (x - pill.x) + s * (y - pill.y)
        let qy = c * (y - pill.y) - s * (x - pill.x)
        qx -= min(half, max(-half, qx))
        return qx * qx + qy * qy < radius * radius
    }

    /// The membrane: out along one side from the first drop to the second, back along the other.
    private static func path(ofBridge p: [Double]) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: p[0], y: p[1]))
        path.addCurve(to: CGPoint(x: p[6], y: p[7]), control1: CGPoint(x: p[2], y: p[3]), control2: CGPoint(x: p[4], y: p[5]))
        path.addLine(to: CGPoint(x: p[8], y: p[9]))
        path.addCurve(to: CGPoint(x: p[14], y: p[15]), control1: CGPoint(x: p[10], y: p[11]), control2: CGPoint(x: p[12], y: p[13]))
        path.closeSubpath()
        return path
    }
}

private extension Color {
    init(_ rgb: Presence.RGB) {
        self.init(.sRGB, red: rgb.red / 255, green: rgb.green / 255, blue: rgb.blue / 255)
    }
}
