import SwiftUI
#if os(watchOS)
import WatchKit
#else
import UIKit
#endif

/// The design system of docs/DESIGN.md, on Apple platforms. Every value
/// comes from `Tokens.swift`, which `packages/design` generates from
/// `tokens.json`: never write a colour, a radius, a size or a duration that
/// is not one of those.
///
/// The iPhone follows the owner's appearance, light or dark; the watch is
/// always dark. Space uses the scale 2 4 8 12 16 20 24 32 44 64 96 and
/// nothing in between.
enum Theme {
    // MARK: Surfaces, text, lines

    /// Where the presence lives: home, a request, adding a computer.
    static let surfaceStage = Tokens.Colors.surfaceStage
    /// The page of a utility surface: the conversation, the list of computers.
    static let surface = Tokens.Colors.surface
    /// Cards, groups of rows, bubbles, the composer. Always with `.raised`.
    static let surfaceRaised = Tokens.Colors.surfaceRaised
    static let line = Tokens.Colors.line
    static let ring = Tokens.Colors.ring
    /// Around pictures.
    static let outline = Tokens.Colors.outline
    static let text = Tokens.Colors.text
    static let textDim = Tokens.Colors.textDim
    static let textFaint = Tokens.Colors.textFaint
    /// Secondary buttons, chips, fields, icon tiles; `fillStrong` when pressed.
    static let fill = Tokens.Colors.fill
    static let fillStrong = Tokens.Colors.fillStrong
    /// The one material, for controls that float over content.
    static let glass = Tokens.Colors.glass

    // MARK: Colours with one job each

    /// The agent is working: activity dots, working chips.
    static let working = Tokens.Colors.working
    static let workingFill = Tokens.Colors.workingFill
    /// The agent is asking — and nothing else is amber.
    static let waiting = Tokens.Colors.waiting
    static let waitingFill = Tokens.Colors.waitingFill
    /// Done, approved: checks and receipts. Never a button's fill.
    static let go = Tokens.Colors.go
    static let goFill = Tokens.Colors.goFill
    /// Be careful: high risk, errors, options marked `danger`. Red never means Stop.
    static let careful = Tokens.Colors.careful
    static let carefulFill = Tokens.Colors.carefulFill
    /// The check on Go ahead: the only colour on the primary button.
    static let primaryCheck = Tokens.Colors.primaryCheck
}

// MARK: - Colour

extension DesignColor: ShapeStyle {
    /// Follows the appearance of where it is drawn — including a part of the
    /// screen that sets its own. The watch is always dark.
    func resolve(in environment: EnvironmentValues) -> Color {
        color(environment.colorScheme)
    }

    /// The value for one appearance, where a plain `Color` is needed (gradients).
    func color(_ scheme: ColorScheme) -> Color {
        #if os(watchOS)
        onDark
        #else
        scheme == .dark ? onDark : onLight
        #endif
    }
}

// MARK: - Type

// The type scale under short names, so that a view says `.type(.body)`.
extension TypeSpec {
    static let displayS = Tokens.TypeScale.displayS
    static let titleL = Tokens.TypeScale.titleL
    static let title = Tokens.TypeScale.title
    static let bodyL = Tokens.TypeScale.bodyL
    static let body = Tokens.TypeScale.body
    static let bodyStrong = Tokens.TypeScale.bodyStrong
    static let small = Tokens.TypeScale.small
    static let label = Tokens.TypeScale.label
    static let caption = Tokens.TypeScale.caption
    static let button = Tokens.TypeScale.button
    static let buttonBig = Tokens.TypeScale.buttonBig
    static let code = Tokens.TypeScale.code
}

private struct TypeStyle: ViewModifier {
    private let spec: TypeSpec
    @ScaledMetric private var size: CGFloat

    init(_ spec: TypeSpec) {
        self.spec = spec
        // The token's size at the default text size, following the owner's setting from there.
        _size = ScaledMetric(wrappedValue: spec.size, relativeTo: spec.style)
    }

    func body(content: Content) -> some View {
        content
            .font(.system(size: size, weight: spec.weight, design: spec.design))
            .tracking(spec.tracking * size)
            // Below 1.2 SwiftUI clips descenders: the tight Display lines get that much.
            .lineHeight(.multiple(factor: max(spec.line, 1.2)))
    }
}

// MARK: - Motion

extension Animation {
    /// A fade over one of the durations: ease-out arriving or changing, ease-in leaving.
    static func fade(_ duration: Double, leaving: Bool = false) -> Animation {
        let (a, b, c, d) = leaving ? Tokens.Motion.easeIn : Tokens.Motion.easeOut
        return .timingCurve(a, b, c, d, duration: duration)
    }
}

extension AnyTransition {
    /// Arrives rising 12 pt from a 4 pt blur on the `gesture` spring; leaves
    /// shorter and quieter: 8 pt up, a 2 pt blur, over `exit` (DESIGN, "Arrive" and "Leave").
    static var arriveLeave: AnyTransition {
        .asymmetric(
            insertion: .modifier(
                active: Moved(y: Tokens.Motion.arriveOffset, blur: Tokens.Motion.arriveBlur, opacity: 0),
                identity: Moved(y: 0, blur: 0, opacity: 1)
            ).animation(Tokens.Motion.gesture.animation),
            removal: .modifier(
                active: Moved(y: Tokens.Motion.leaveOffset, blur: 2, opacity: 0),
                identity: Moved(y: 0, blur: 0, opacity: 1)
            ).animation(.fade(Tokens.Motion.exit, leaving: true)))
    }
}

/// Somewhere on the way in or out. With Reduce Motion, only the fade is left.
private struct Moved: ViewModifier {
    let y: CGFloat
    let blur: CGFloat
    let opacity: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(opacity)
            .blur(radius: reduceMotion ? 0 : blur)
            .offset(y: reduceMotion ? 0 : y)
    }
}

/// One chunk of something arriving: it rises from a blur, `order` beats
/// after the first chunk (DESIGN, "Arrive"). Only when it first appears.
private struct Arrive: ViewModifier {
    let order: Int
    @State private var isIn = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let delay = Double(order) * Tokens.Motion.stagger
        content
            .opacity(isIn ? 1 : 0)
            .blur(radius: isIn || reduceMotion ? 0 : Tokens.Motion.arriveBlur)
            .animation(.fade(reduceMotion ? Tokens.Motion.exit : Tokens.Motion.base).delay(delay), value: isIn)
            .offset(y: isIn || reduceMotion ? 0 : Tokens.Motion.arriveOffset)
            .animation(Tokens.Motion.gesture.animation.delay(delay), value: isIn)
            .onAppear { isIn = true }
    }
}

// MARK: - Depth

extension View {
    /// Sets text in one of the type tokens, following Dynamic Type.
    func type(_ spec: TypeSpec) -> some View {
        modifier(TypeStyle(spec))
    }

    /// A chunk of something arriving, `order` beats after the first.
    func arrive(_ order: Int) -> some View {
        modifier(Arrive(order: order))
    }

    /// Lifts the view off its surface: lit from above, with a 1 pt ring, a
    /// 1 pt highlight on the top edge and a soft shadow — `Tokens.Elevation`.
    func raised<S: InsettableShape>(
        _ fill: some ShapeStyle = Theme.surfaceRaised, in shape: S,
        _ elevation: (dark: ElevationSpec, light: ElevationSpec) = Tokens.Elevation.raised
    ) -> some View {
        background(Elevated(fill: fill, shape: shape, elevation: elevation))
    }

    /// A presence surface: where the presence lives. It follows the
    /// appearance — a warm night, or warm daylight with the presence as a
    /// black pearl. The watch is true black, always dark.
    func presenceSurface() -> some View {
        #if os(watchOS)
        background(Color.black.ignoresSafeArea())
            .foregroundStyle(Theme.text)
            .environment(\.colorScheme, .dark)
        #else
        background(Theme.surfaceStage)
            .foregroundStyle(Theme.text)
        #endif
    }
}

private struct Elevated<Fill: ShapeStyle, S: InsettableShape>: View {
    let fill: Fill
    let shape: S
    let elevation: (dark: ElevationSpec, light: ElevationSpec)

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let spec = colorScheme == .dark ? elevation.dark : elevation.light
        ZStack {
            // One copy of the shape per shadow, so that no shadow casts a shadow of its own.
            ForEach(spec.shadows.indices, id: \.self) { index in
                let layer = spec.shadows[index]
                // SwiftUI has no spread: a shadow pulled in is drawn fainter instead.
                let pulledIn = max(0.3, 1 + min(layer.spread, 0) / max(layer.blur, 1))
                shape.fill(fill)
                    .shadow(color: layer.color.opacity(pulledIn), radius: layer.blur / 2, x: layer.x, y: layer.y)
            }
            shape.fill(fill)
            shape.strokeBorder(spec.ring, lineWidth: 1)
            shape.strokeBorder(
                LinearGradient(colors: [spec.highlight, spec.highlight.opacity(0)], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.12)),
                lineWidth: 1)
        }
    }
}

// MARK: - Buttons

/// The looks a button can have (docs/DESIGN.md, "Button").
enum ButtonLook {
    /// The one way forward on a screen, and *Go ahead*: pearl on dark, ink on light.
    case primary
    /// Everything else that matters, *Stop* included.
    case secondary
    /// Things one rarely needs.
    case quiet
    /// An option the agent marks `danger`. Never the default.
    case careful
}

/// How tall a button is: 36 (with a 44 hit area), 44, 52 in a card, 56 on a phone screen.
enum ButtonSize {
    case sm, md, lg, big

    var height: CGFloat {
        switch self {
        case .sm: Tokens.Size.controlSm
        case .md: Tokens.Size.control
        case .lg: Tokens.Size.controlLg
        case .big: Tokens.Size.controlBig
        }
    }

    fileprivate var type: TypeSpec { self == .lg || self == .big ? .buttonBig : .button }
    fileprivate var padding: CGFloat { self == .big ? Tokens.Space.s24 : self == .sm ? Tokens.Space.s16 : Tokens.Space.s20 }
}

/// A capsule, or — inside a card — a rounded rectangle concentric with it.
struct ButtonShape: InsettableShape {
    /// Nil for a capsule.
    var radius: CGFloat?
    private var inset: CGFloat = 0

    init(radius: CGFloat? = nil) {
        self.radius = radius
    }

    func path(in rect: CGRect) -> Path {
        let rect = rect.insetBy(dx: inset, dy: inset)
        let corner = radius.map { max(0, $0 - inset) } ?? min(rect.width, rect.height) / 2
        return RoundedRectangle(cornerRadius: corner, style: .continuous).path(in: rect)
    }

    func inset(by amount: CGFloat) -> ButtonShape {
        var shape = self
        shape.inset += amount
        return shape
    }
}

/// One line, a verb. Pressed, it sinks to 0.96 at once and darkens; let
/// go, it comes back on the `press` spring.
struct CapsuleButtonStyle: ButtonStyle {
    var look = ButtonLook.secondary
    var size = ButtonSize.md
    /// Takes the whole width.
    var wide = false
    /// Inside a card: concentric with it rather than a capsule.
    var inCard = false
    /// An icon alone: a circle as high as the button.
    var round = false

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let shape = ButtonShape(radius: inCard ? Tokens.Radius.m : nil)
        let isPressed = configuration.isPressed
        configuration.label
            .type(size.type)
            .lineLimit(1)
            // A label that lacks room shrinks before it is cut.
            .minimumScaleFactor(0.7)
            .foregroundStyle(label)
            .padding(.horizontal, round ? 0 : size.padding)
            .frame(minWidth: size.height, maxWidth: wide ? .infinity : nil, minHeight: size.height)
            .background { background(shape, isPressed: isPressed) }
            .overlay {
                // Held: a darker overlay over the whole button.
                shape.fill(Color.black.opacity(isPressed && look != .quiet ? Tokens.Control.pressOverlay : 0))
            }
            .contentShape(shape)
            .scaleEffect(isPressed ? Tokens.Control.press : 1)
            .animation(isPressed ? .fade(Tokens.Motion.instant) : Tokens.Motion.press.animation, value: isPressed)
            // A small button still has a 44 pt target.
            .padding(.vertical, (Tokens.Size.control - min(size.height, Tokens.Size.control)) / 2)
            .contentShape(Rectangle())
    }

    private var label: DesignColor {
        guard isEnabled else { return Theme.textFaint }
        return switch look {
        case .primary: Tokens.Colors.onPrimary
        case .secondary: Theme.text
        case .quiet: Theme.textDim
        case .careful: Theme.careful
        }
    }

    private func background(_ shape: ButtonShape, isPressed: Bool) -> some View {
        // Disabled: a neutral fill and no shadow, whatever the look.
        ButtonFace(look: isEnabled || look == .quiet ? look : .secondary, shape: shape, isPressed: isPressed)
    }
}

/// What a button is made of, behind its label, for each look.
struct ButtonFace: View {
    let look: ButtonLook
    let shape: ButtonShape
    var isPressed = false

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        switch look {
        case .primary:
            // The presence's own pearl (ink in the light), lit from above.
            Color.clear.raised(
                LinearGradient(
                    colors: [Tokens.Colors.primaryTop.color(colorScheme), Tokens.Colors.primaryBottom.color(colorScheme)],
                    startPoint: .top, endPoint: .bottom),
                in: shape, Tokens.Elevation.button)
        case .secondary:
            shape.fill(isPressed ? Theme.fillStrong : Theme.fill)
                .overlay { shape.strokeBorder(Theme.ring, lineWidth: 1) }
        case .quiet:
            shape.fill(isPressed ? Theme.fill : Theme.fill.clear)
        case .careful:
            shape.fill(Theme.carefulFill)
                .overlay { shape.strokeBorder(Theme.careful.opacity(0.24), lineWidth: 1) }
        }
    }
}

extension DesignColor {
    /// The same colour, fully transparent: what a quiet button rests on.
    var clear: DesignColor { DesignColor(dark: dark, 0, light: light, 0) }
}

extension ButtonStyle where Self == CapsuleButtonStyle {
    static func capsule(_ look: ButtonLook = .secondary, size: ButtonSize = .md, wide: Bool = false, inCard: Bool = false) -> CapsuleButtonStyle {
        CapsuleButtonStyle(look: look, size: size, wide: wide, inCard: inCard)
    }
}

/// A round icon button, 44 pt, with a name for those who cannot see its icon.
struct RoundButton: View {
    let icon: String
    let label: LocalizedStringKey
    var look = ButtonLook.secondary
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
        }
        .buttonStyle(CapsuleButtonStyle(look: look, round: true))
        .accessibilityLabel(label)
    }
}

// MARK: - Haptics

/// One meaning per haptic, and only for what really happened: an answer
/// counts once the computer confirmed it (docs/DESIGN.md, "Haptics").
enum Haptics {
    @MainActor
    static func play(_ moment: (ios: String, watch: String)) {
        #if os(watchOS)
        let type: WKHapticType? = switch moment.watch {
        case "notification": .notification
        case "success": .success
        case "stop": .stop
        case "retry": .retry
        default: nil
        }
        if let type { WKInterfaceDevice.current().play(type) }
        #else
        switch moment.ios {
        case "impact.light": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "impact.rigid": UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        case "notification.success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "notification.error": UINotificationFeedbackGenerator().notificationOccurred(.error)
        default: break
        }
        #endif
    }
}
