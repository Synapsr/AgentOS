// Generated from packages/design/tokens.json by scripts/generate.mjs. Do not edit: edit tokens.json and run `pnpm --filter @agentos/design build`.
// See docs/DESIGN.md. Compiled into the iPhone app and the watch app.

import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// A colour of the design system: its value on dark surfaces and on light ones.
struct DesignColor: Sendable {
    let dark: UInt32
    let darkOpacity: Double
    let light: UInt32
    let lightOpacity: Double

    init(dark: UInt32, _ darkOpacity: Double, light: UInt32, _ lightOpacity: Double) {
        self.dark = dark
        self.darkOpacity = darkOpacity
        self.light = light
        self.lightOpacity = lightOpacity
    }

    /// The value on dark surfaces, whatever the system says (presence surfaces).
    var onDark: Color { designColor(dark, darkOpacity) }
    /// The value on light surfaces.
    var onLight: Color { designColor(light, lightOpacity) }

    /// Follows the appearance. The watch is a presence surface: always the dark value.
    var color: Color {
        #if os(watchOS)
        onDark
        #else
        let dark = UIColor(onDark), light = UIColor(onLight)
        return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
        #endif
    }
}

/// A colour from its hex value and opacity, in sRGB.
private func designColor(_ hex: UInt32, _ opacity: Double) -> Color {
    Color(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: opacity)
}

/// A size of the type scale, following Dynamic Type from its `style`.
struct TypeSpec: Sendable {
    let size: CGFloat
    /// Line height as a multiple of the size.
    let line: CGFloat
    let weight: Font.Weight
    /// Letter-spacing in em: multiply by the size in use.
    let tracking: CGFloat
    let style: Font.TextStyle
    let design: Font.Design
}

/// A spring, as SwiftUI defines it: perceived duration in seconds, and bounce.
struct SpringSpec: Sendable {
    let duration: Double
    let bounce: Double
    var animation: Animation { .spring(duration: duration, bounce: bounce) }
}

/// One layer of a shadow, in points.
struct ShadowLayer: Sendable {
    let x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat
    let color: Color
}

/// An elevation: the 1 px ring, the 1 px top highlight and the shadow beneath.
struct ElevationSpec: Sendable {
    let ring: Color
    let highlight: Color
    let shadows: [ShadowLayer]
}

/// The colours of the presence in one state, on one kind of surface.
struct PresenceLook: Sendable {
    let from: Color, to: Color, core: Color, halo: Color
    let glow: Double
}

/// The side of the presence's stage: a share of the box it may use, kept between `min` and `max`.
struct StageRule: Sendable {
    let height: CGFloat, width: CGFloat, min: CGFloat, max: CGFloat
    func size(in box: CGSize) -> CGFloat {
        Swift.max(min, Swift.min(box.height * height, box.width * width, max)).rounded()
    }
}

/// Every token of docs/DESIGN.md.
enum Tokens {
    enum Colors {
        /// The watch and the screens OS mode covers: true black for OLED and Always On.
        static let black = DesignColor(dark: 0x000000, 1, light: 0x000000, 1)
        /// Where the presence lives: the home stage, the panel's header, phone home. A warm night in dark, warm daylight in light. OS mode stays dark.
        static let surfaceStage = DesignColor(dark: 0x0C0B0A, 1, light: 0xEEECE8, 1)
        /// The page of a utility surface: panel, settings, onboarding, the conversation column.
        static let surface = DesignColor(dark: 0x171513, 1, light: 0xF3F2F0, 1)
        /// Cards, groups of rows, bubbles, fields. Always with shadow-raised.
        static let surfaceRaised = DesignColor(dark: 0x25221E, 1, light: 0xFFFFFF, 1)
        /// Things that float: sheets, menus, toasts, the OS-mode request. Always with shadow-overlay.
        static let surfaceOverlay = DesignColor(dark: 0x302C28, 1, light: 0xFFFFFF, 1)
        /// Hairlines between rows.
        static let line = DesignColor(dark: 0xFFF5EB, 0.08, light: 0x23190F, 0.08)
        /// The edge of what is selected.
        static let lineStrong = DesignColor(dark: 0xF7F3EE, 0.9, light: 0x1D1A17, 0.85)
        /// The 1 px edge of a control: secondary buttons, fields, chips.
        static let ring = DesignColor(dark: 0xFFF5EB, 0.1, light: 0x23190F, 0.14)
        /// Around pictures: pure white or black, never a tinted grey.
        static let outline = DesignColor(dark: 0xFFFFFF, 0.1, light: 0x000000, 0.1)
        /// Primary text.
        static let text = DesignColor(dark: 0xF7F3EE, 1, light: 0x1D1A17, 1)
        /// Secondary text. Readable (4.5:1) on every surface.
        static let textDim = DesignColor(dark: 0xF7F3EE, 0.7, light: 0x1D1A17, 0.68)
        /// Placeholders and disabled labels: never something that must be read.
        static let textFaint = DesignColor(dark: 0xF7F3EE, 0.42, light: 0x1D1A17, 0.42)
        /// A neutral control: secondary buttons, chips, fields, icon tiles.
        static let fill = DesignColor(dark: 0xFFF5EB, 0.09, light: 0x23190F, 0.07)
        /// The same under the pointer, or pressed.
        static let fillStrong = DesignColor(dark: 0xFFF5EB, 0.14, light: 0x23190F, 0.11)
        /// The primary button: pearl on dark, ink on light. Made of the presence's own idle colour.
        static let primary = DesignColor(dark: 0xF4EEE6, 1, light: 0x24201C, 1)
        /// Top of the primary button's gradient (light from above).
        static let primaryTop = DesignColor(dark: 0xFFFCF8, 1, light: 0x35302B, 1)
        /// Bottom of the primary button's gradient.
        static let primaryBottom = DesignColor(dark: 0xECE5DB, 1, light: 0x1C1916, 1)
        /// The 1 px inner light along the primary button's top edge.
        static let primaryHighlight = DesignColor(dark: 0xFFFFFF, 0.9, light: 0xFFFFFF, 0.16)
        /// The label on a primary button.
        static let onPrimary = DesignColor(dark: 0x1D1A17, 1, light: 0xFBF8F4, 1)
        /// The check on Go ahead: the only colour on the primary button.
        static let primaryCheck = DesignColor(dark: 0x1E8A4C, 1, light: 0x4FD18B, 1)
        /// The agent is working: activity dots, progress, selection. Also the keyboard focus ring, as on every Mac.
        static let working = DesignColor(dark: 0x6CB4FF, 1, light: 0x1A63C0, 1)
        /// Behind a working chip.
        static let workingFill = DesignColor(dark: 0x6CB4FF, 0.14, light: 0x1A63C0, 0.1)
        /// The agent is asking. Nothing else is amber.
        static let waiting = DesignColor(dark: 0xFFB547, 1, light: 0x965600, 1)
        /// Behind an asking chip.
        static let waitingFill = DesignColor(dark: 0xFFB547, 0.14, light: 0xE8900C, 0.12)
        /// The presence's light falling on a request: the card's top edge and corner wash. Decoration only, never text.
        static let askingLight = DesignColor(dark: 0xFFB547, 1, light: 0xE8900C, 1)
        /// Done, approved: the check of Go ahead and of receipts. Icons only (3:1), never a button fill.
        static let go = DesignColor(dark: 0x4FD18B, 1, light: 0x1E8A4C, 1)
        /// Behind a check in a receipt.
        static let goFill = DesignColor(dark: 0x4FD18B, 0.16, light: 0x1E8A4C, 0.1)
        /// Be careful: high risk, errors, options marked danger. Red never means Stop.
        static let careful = DesignColor(dark: 0xFF8E80, 1, light: 0xB02E25, 1)
        /// Behind the high-risk banner and a careful button.
        static let carefulFill = DesignColor(dark: 0xFF8E80, 0.12, light: 0xB02E25, 0.08)
        /// The same under the pointer.
        static let carefulFillStrong = DesignColor(dark: 0xFF8E80, 0.16, light: 0xB02E25, 0.12)
        /// The 2 px keyboard focus ring, 2 px away from the edge.
        static let focus = DesignColor(dark: 0x6CB4FF, 1, light: 0x1A63C0, 1)
        /// Behind a sheet.
        static let scrim = DesignColor(dark: 0x080604, 0.62, light: 0x23190F, 0.28)
        /// The one material: controls that float over content (the phone composer, OS-mode controls). Never glass on glass.
        static let glass = DesignColor(dark: 0x282420, 0.72, light: 0xFFFFFF, 0.72)
    }

    /// The presence's colours per state. `dark` on presence surfaces, `light` on light utility surfaces.
    enum Presence {
        /// Pearl: resting, content. A warm white, not a cold one.
        static let idle = (dark: PresenceLook(from: designColor(0xFFFCF7, 1), to: designColor(0xE7DDD0, 1), core: designColor(0xFFFFFF, 1), halo: designColor(0xFFE6C7, 1), glow: 0.22), light: PresenceLook(from: designColor(0x1E1C1A, 1), to: designColor(0x34302D, 1), core: designColor(0xB8B2AC, 1), halo: designColor(0x1E1C1A, 1), glow: 0))
        /// Lagoon: busy. Azure into aqua, like water, not the blue-violet every AI product uses.
        static let working = (dark: PresenceLook(from: designColor(0x62A8FF, 1), to: designColor(0x46D3C5, 1), core: designColor(0xE2F4FF, 1), halo: designColor(0x55B8F0, 1), glow: 0.36), light: PresenceLook(from: designColor(0x2F7FE6, 1), to: designColor(0x12A39A, 1), core: designColor(0x8CC8FF, 1), halo: designColor(0x2F7FE6, 1), glow: 0.16))
        /// Amber: the agent needs its owner.
        static let waiting = (dark: PresenceLook(from: designColor(0xFFC75C, 1), to: designColor(0xFF9B3F, 1), core: designColor(0xFFF1CF, 1), halo: designColor(0xFFAA47, 1), glow: 0.42), light: PresenceLook(from: designColor(0xF29A12, 1), to: designColor(0xE2700A, 1), core: designColor(0xFFD68A, 1), halo: designColor(0xF29A12, 1), glow: 0.2))
        /// White with a cool edge: taking your words in.
        static let listening = (dark: PresenceLook(from: designColor(0xFFFFFF, 1), to: designColor(0xD7ECFF, 1), core: designColor(0xFFFFFF, 1), halo: designColor(0xBFDDFF, 1), glow: 0.3), light: PresenceLook(from: designColor(0x1E1C1A, 1), to: designColor(0x262C36, 1), core: designColor(0xA9BDD8, 1), halo: designColor(0x1E1C1A, 1), glow: 0))
        /// White with a warm edge: giving words out.
        static let speaking = (dark: PresenceLook(from: designColor(0xFFFFFF, 1), to: designColor(0xFFE4D1, 1), core: designColor(0xFFFFFF, 1), halo: designColor(0xFFD3B5, 1), glow: 0.3), light: PresenceLook(from: designColor(0x1E1C1A, 1), to: designColor(0x322B27, 1), core: designColor(0xD9BFAE, 1), halo: designColor(0x1E1C1A, 1), glow: 0))
        /// Warm grey, no glow: asleep, not broken.
        static let offline = (dark: PresenceLook(from: designColor(0x5F5953, 1), to: designColor(0x4C4743, 1), core: designColor(0x6B655F, 1), halo: designColor(0x5F5953, 1), glow: 0), light: PresenceLook(from: designColor(0xBDB7B1, 1), to: designColor(0xCBC6C0, 1), core: designColor(0xD6D1CB, 1), halo: designColor(0xBDB7B1, 1), glow: 0))
        /// A change between two coloured states travels through this light, never through the muddy mix of the two.
        static let via = DesignColor(dark: 0xFFFCF7, 1, light: 0x24201C, 1)
        /// The presence's light on the stage beneath it: its state colour at this opacity, in a radial gradient this many times the stage size. Off on the watch.
        static let stageLight: Double = 0.1
    }

    enum TypeScale {
        /// The agent's line in OS mode; the website's hero.
        static let displayXl = TypeSpec(size: 56, line: 1.04, weight: .regular, tracking: -0.028, style: .largeTitle, design: .rounded)
        /// The line on the desktop home; the question in OS mode.
        static let displayL = TypeSpec(size: 44, line: 1.08, weight: .regular, tracking: -0.024, style: .largeTitle, design: .rounded)
        /// Onboarding questions; website headings.
        static let displayM = TypeSpec(size: 34, line: 1.12, weight: .regular, tracking: -0.02, style: .title, design: .rounded)
        /// The line on a phone and in the panel; the question of a request on a phone.
        static let displayS = TypeSpec(size: 28, line: 1.16, weight: .regular, tracking: -0.016, style: .title2, design: .rounded)
        /// Screen titles (Settings); the question of a request card on the desktop.
        static let titleL = TypeSpec(size: 24, line: 1.25, weight: .semibold, tracking: -0.014, style: .title2, design: .default)
        /// Section titles, sheet titles, the question of a request in the side panel and on the watch.
        static let title = TypeSpec(size: 20, line: 1.3, weight: .semibold, tracking: -0.01, style: .title3, design: .default)
        /// The agent's words in the conversation; leads on the website.
        static let bodyL = TypeSpec(size: 18, line: 1.5, weight: .regular, tracking: -0.004, style: .body, design: .default)
        /// Everything else that is read.
        static let body = TypeSpec(size: 16, line: 1.5, weight: .regular, tracking: 0, style: .body, design: .default)
        /// Row titles, the owner's name for things.
        static let bodyStrong = TypeSpec(size: 16, line: 1.4, weight: .semibold, tracking: 0, style: .headline, design: .default)
        /// Secondary text: row subtitles, details, helper lines.
        static let small = TypeSpec(size: 15, line: 1.45, weight: .regular, tracking: 0, style: .subheadline, design: .default)
        /// Short labels: "Nova is asking", chips, section headers.
        static let label = TypeSpec(size: 14, line: 1.3, weight: .semibold, tracking: 0, style: .footnote, design: .default)
        /// Times and counts beside something larger. Never a sentence.
        static let caption = TypeSpec(size: 13, line: 1.35, weight: .medium, tracking: 0.004, style: .caption, design: .default)
        /// The label of a button up to 44 px high.
        static let button = TypeSpec(size: 16, line: 1.2, weight: .semibold, tracking: 0, style: .body, design: .default)
        /// The label of a 52 px button and taller.
        static let buttonBig = TypeSpec(size: 17, line: 1.2, weight: .semibold, tracking: 0, style: .body, design: .default)
        /// The agent's name above a large stage.
        static let nameLarge = TypeSpec(size: 20, line: 1.3, weight: .medium, tracking: 0, style: .title3, design: .default)
        /// Commands, paths and addresses, inside Details and Advanced only.
        static let code = TypeSpec(size: 14, line: 1.5, weight: .regular, tracking: 0, style: .callout, design: .monospaced)
    }

    /// The spacing scale. Nothing in between.
    enum Space {
        static let s2: CGFloat = 2
        static let s4: CGFloat = 4
        static let s8: CGFloat = 8
        static let s12: CGFloat = 12
        static let s16: CGFloat = 16
        static let s20: CGFloat = 20
        static let s24: CGFloat = 24
        static let s32: CGFloat = 32
        static let s44: CGFloat = 44
        static let s64: CGFloat = 64
        static let s96: CGFloat = 96
    }

    /// Corner radii. Single-line controls are capsules.
    enum Radius {
        static let s: CGFloat = 10
        static let m: CGFloat = 16
        static let l: CGFloat = 22
        static let xl: CGFloat = 28
        static let xxl: CGFloat = 36
    }

    enum Size {
        static let control: CGFloat = 44
        static let controlSm: CGFloat = 36
        static let controlLg: CGFloat = 52
        static let controlBig: CGFloat = 56
        static let controlXl: CGFloat = 64
        static let row: CGFloat = 64
        static let rowSingle: CGFloat = 52
        static let icon: CGFloat = 20
        static let iconDense: CGFloat = 16
        static let iconLarge: CGFloat = 24
        static let iconTile: CGFloat = 32
        static let iconStroke: CGFloat = 1.75
        static let measure: CGFloat = 680
        static let measureNarrow: CGFloat = 560
        static let panel: CGFloat = 380
    }

    /// How a control answers a finger.
    enum Control {
        static let press: CGFloat = 0.96
        static let pressOverlay: Double = 0.08
        static let disabled: Double = 0.4
        /// A request's buttons ignore taps for this long after it appears, in seconds.
        static let touchGuard: Double = 0.4
    }

    /// `dark` on dark surfaces, `light` on light ones.
    enum Elevation {
        static let raised = (dark: ElevationSpec(ring: designColor(0xFFF5EB, 0.07), highlight: designColor(0xFFFAF5, 0.06), shadows: [ShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: designColor(0x000000, 0.3)), ShadowLayer(x: 0, y: 8, blur: 24, spread: -12, color: designColor(0x000000, 0.55))]), light: ElevationSpec(ring: designColor(0x23190F, 0.07), highlight: designColor(0xFFFFFF, 0), shadows: [ShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: designColor(0x23190F, 0.06)), ShadowLayer(x: 0, y: 6, blur: 16, spread: -8, color: designColor(0x23190F, 0.12))]))
        static let overlay = (dark: ElevationSpec(ring: designColor(0xFFF5EB, 0.09), highlight: designColor(0xFFFAF5, 0.08), shadows: [ShadowLayer(x: 0, y: 2, blur: 6, spread: 0, color: designColor(0x000000, 0.35)), ShadowLayer(x: 0, y: 24, blur: 64, spread: -16, color: designColor(0x000000, 0.7))]), light: ElevationSpec(ring: designColor(0x23190F, 0.08), highlight: designColor(0xFFFFFF, 0), shadows: [ShadowLayer(x: 0, y: 2, blur: 6, spread: 0, color: designColor(0x23190F, 0.06)), ShadowLayer(x: 0, y: 24, blur: 64, spread: -16, color: designColor(0x23190F, 0.22))]))
        static let button = (dark: ElevationSpec(ring: designColor(0xFFFFFF, 0.1), highlight: designColor(0xFFFFFF, 0.9), shadows: [ShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: designColor(0x000000, 0.35)), ShadowLayer(x: 0, y: 6, blur: 16, spread: -6, color: designColor(0x000000, 0.45))]), light: ElevationSpec(ring: designColor(0x000000, 0.2), highlight: designColor(0xFFFFFF, 0.16), shadows: [ShadowLayer(x: 0, y: 1, blur: 2, spread: 0, color: designColor(0x23190F, 0.2)), ShadowLayer(x: 0, y: 6, blur: 16, spread: -6, color: designColor(0x23190F, 0.35))]))
    }

    /// Sides of the presence's stage, per surface.
    enum Stage {
        static let os = StageRule(height: 0.56, width: 0.9, min: 160, max: 600)
        static let osAsking = StageRule(height: 0.24, width: 0.9, min: 120, max: 260)
        static let home = StageRule(height: 0.3, width: 1, min: 160, max: 300)
        static let homeBeside = StageRule(height: 0.5, width: 0.72, min: 160, max: 440)
        static let homeAsking: CGFloat = 96
        static let onboarding = StageRule(height: 0.3, width: 1, min: 140, max: 240)
        static let watch: CGFloat = 120
        static let watchAsking: CGFloat = 36
        static let panel: CGFloat = 80
        static let panelAsking: CGFloat = 48
        static let row: CGFloat = 32
        static let inline: CGFloat = 24
        static let label: CGFloat = 20
    }

    enum Motion {
        /// Durations in seconds, for what fades rather than moves.
        static let instant: Double = 0.08
        static let fast: Double = 0.12
        static let exit: Double = 0.15
        static let base: Double = 0.2
        static let slow: Double = 0.4
        /// Cubic-bezier control points, for `Animation.timingCurve`.
        static let easeOut: (Double, Double, Double, Double) = (0.2, 0, 0, 1)
        static let easeIn: (Double, Double, Double, Double) = (0.4, 0, 1, 1)
        static let easeInOut: (Double, Double, Double, Double) = (0.45, 0, 0.2, 1)
        /// Icons swapping, chips, small state changes.
        static let snappy = SpringSpec(duration: 0.25, bounce: 0)
        /// A control coming back after a press.
        static let press = SpringSpec(duration: 0.3, bounce: 0.15)
        /// Things changing size or place: a card folding into a receipt, a sheet, a row unfolding.
        static let layout = SpringSpec(duration: 0.45, bounce: 0)
        /// Things arriving with intent: a request card, a toast, a step of onboarding.
        static let gesture = SpringSpec(duration: 0.5, bounce: 0.25)
        /// Colour, light and opacity changing.
        static let material = SpringSpec(duration: 0.6, bounce: 0)
        static let arriveOffset: CGFloat = 12
        static let arriveBlur: CGFloat = 4
        static let stagger: Double = 0.06
        static let leaveOffset: CGFloat = -8
        static let iconSwapScale: CGFloat = 0.25
        static let resolveOthers: Double = 0.12
        static let resolveFold: Double = 0.6
        static let lineOut: Double = 0.12
        static let lineIn: Double = 0.2
    }

    /// Which haptic means what: names of UIKit feedback and of WKHapticType.
    enum Haptic {
        static let requestArrives = (ios: "impact.light", watch: "notification")
        static let approved = (ios: "notification.success", watch: "success")
        static let stopped = (ios: "impact.rigid", watch: "stop")
        static let failed = (ios: "notification.error", watch: "retry")
        static let phoneAdded = (ios: "notification.success", watch: "success")
    }
}
