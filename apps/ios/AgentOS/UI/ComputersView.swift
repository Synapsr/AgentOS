import SwiftUI

/// The computers this phone has been added to: choose one, add one, remove
/// one. A utility surface: it follows the system's appearance. Nothing
/// technical here: a computer is its name, its agent and how it is doing.
struct ComputersView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var isAdding = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.stores) { store in
                        Button {
                            model.select(store)
                            dismiss()
                        } label: {
                            row(store)
                        }
                        .swipeActions {
                            Button("Remove", role: .destructive) { model.remove(store) }
                        }
                        .listRowBackground(Rectangle().fill(Theme.surfaceRaised))
                    }
                }
                Section {
                    Button {
                        isAdding = true
                    } label: {
                        HStack(spacing: Tokens.Space.s12) {
                            Tile(icon: "plus")
                            Text("Add a computer")
                                .type(.bodyStrong)
                        }
                        .frame(minHeight: Tokens.Size.rowSingle)
                    }
                    .listRowBackground(Rectangle().fill(Theme.surfaceRaised))
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .foregroundStyle(Theme.text)
            .navigationTitle("Your computers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .fullScreenCover(isPresented: $isAdding) {
                PairingView { isAdding = false }
            }
        }
    }

    private func row(_ store: ComputerStore) -> some View {
        HStack(spacing: Tokens.Space.s12) {
            PresenceView(state: store.presenceState, size: Tokens.Stage.row)
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(verbatim: store.computer.name)
                    .type(.bodyStrong)
                (store.presenceState == .offline ? Text("Can't reach it") : Text(verbatim: store.computer.agentName))
                    .type(.small)
                    .foregroundStyle(Theme.textDim)
            }
            Spacer()
            if store === model.selected {
                Image(systemName: "checkmark")
                    .font(.system(size: Tokens.Size.iconDense, weight: .semibold))
                    .foregroundStyle(Theme.go)
                    .accessibilityLabel("Selected")
            }
        }
        .frame(minHeight: Tokens.Size.row)
    }
}

/// The tile behind an icon at the head of a row.
private struct Tile: View {
    let icon: String

    var body: some View {
        Image(systemName: icon)
            .font(.system(size: Tokens.Size.iconDense, weight: .medium))
            .foregroundStyle(Theme.text)
            .frame(width: Tokens.Size.iconTile, height: Tokens.Size.iconTile)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: Tokens.Radius.s, style: .continuous))
            .accessibilityHidden(true)
    }
}
