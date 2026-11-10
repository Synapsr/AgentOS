import AVFoundation
import SwiftUI
import VisionKit

/// Adding this phone to a computer: scan the code the computer shows, or
/// paste its link — then say yes to the computer it names. Wherever a code
/// comes from, nothing is sent until the owner has seen whose it is and
/// where it leads.
struct PairingView: View {
    /// Set when this is shown over the app, to add one more computer.
    var close: (() -> Void)?

    @Environment(AppModel.self) private var model
    @State private var canScan = false

    var body: some View {
        GeometryReader { screen in
            content(stage: Tokens.Stage.onboarding.size(in: screen.size))
        }
        .presenceSurface()
        .animation(Tokens.Motion.layout.animation, value: model.pairing)
        .task {
            guard DataScannerViewController.isSupported else { return }
            canScan = await AVCaptureDevice.requestAccess(for: .video)
        }
        // Adding went through: nothing more to do here.
        .onChange(of: model.pairing) { before, now in
            if case .adding = before, now == nil { close?() }
        }
    }

    private func content(stage: CGFloat) -> some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                if let close {
                    RoundButton(icon: "xmark", label: "Close", look: .quiet, action: close)
                }
            }
            .frame(minHeight: 56)
            Spacer(minLength: 16)
            if canScan, model.pairing == nil {
                CodeScanner { code in
                    model.pair(with: code)
                }
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.xl, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.xl, style: .continuous).strokeBorder(Theme.outline))
                .padding(.horizontal, Tokens.Space.s24)
                .padding(.bottom, Tokens.Space.s32)
            } else {
                PresenceView(state: presenceState, size: stage)
            }
            VStack(spacing: Tokens.Space.s12) {
                Text(title)
                    .type(.displayS)
                if let detail {
                    detail
                        .type(.body)
                        .foregroundStyle(Theme.textDim)
                }
                if case .confirming(let link) = model.pairing {
                    // Where the code leads — the one thing a forged code cannot
                    // hide — for whoever wants to check it.
                    DetailsDisclosure(text: link.urls.compactMap { $0.host() }.reduce(into: [String]()) { hosts, host in
                        if !hosts.contains(host) { hosts.append(host) }
                    }.joined(separator: "\n"), alignment: .center)
                    .frame(maxWidth: Tokens.Size.measureNarrow)
                }
            }
            .multilineTextAlignment(.center)
            Spacer(minLength: Tokens.Space.s16)
            switch model.pairing {
            case .confirming:
                VStack(spacing: Tokens.Space.s8) {
                    Button("Add") { Task { await model.confirmPairing() } }
                        .buttonStyle(.capsule(.primary, size: .big, wide: true))
                    Button("Cancel") { model.dismissPairing() }
                        .buttonStyle(.capsule(.quiet, wide: true))
                }
            case .failed:
                Button("Try again") { model.dismissPairing() }
                    .buttonStyle(.capsule(.primary, size: .big, wide: true))
            case .adding:
                EmptyView()
            case nil:
                PasteButton(payloadType: String.self) { strings in
                    model.pair(with: strings.first ?? "")
                }
                .labelStyle(.titleAndIcon)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(Tokens.Colors.primary)
                .foregroundStyle(Tokens.Colors.onPrimary)
            }
        }
        .padding(.horizontal, Tokens.Space.s16)
        .padding(.bottom, Tokens.Space.s24)
    }

    private var presenceState: Presence.State {
        switch model.pairing {
        case nil, .confirming: .idle
        case .adding: .working
        case .failed: .offline
        }
    }

    private var title: LocalizedStringKey {
        switch model.pairing {
        case nil: "Scan the code on your computer"
        case .confirming(let link) where link.name.isEmpty: "Add this computer?"
        case .confirming(let link): "Add \(link.name)?"
        case .adding(let name): "Adding \(name)…"
        case .failed: "That didn't work"
        }
    }

    private var detail: Text? {
        switch model.pairing {
        case nil: Text("On your computer, open AgentOS and choose “Add your phone”.")
        // Never silently: a code for a computer this phone knows changes how that computer is reached.
        case .confirming(let link) where model.knows(link): Text("You already added this computer. Adding it again replaces how this phone reaches it.")
        case .confirming: nil
        case .adding: nil
        case .failed(let reason): Text(reason)
        }
    }
}

/// The camera, looking for a QR code.
private struct CodeScanner: UIViewControllerRepresentable {
    var found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(found: found)
    }

    final class Coordinator: DataScannerViewControllerDelegate {
        let found: (String) -> Void

        init(found: @escaping (String) -> Void) {
            self.found = found
        }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let code) in items {
                if let text = code.payloadStringValue, PairingLink(text) != nil {
                    scanner.stopScanning()
                    return found(text)
                }
            }
        }
    }
}
