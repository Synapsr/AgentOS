import SwiftUI

/// What is on screen: adding a first computer, or home — with the
/// conversation and the list of computers as sheets, which close whenever
/// an agent asks.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var conversation: Conversation?
    @State private var showsComputers = false

    private struct Conversation: Identifiable {
        let store: ComputerStore
        let threadId: String
        var id: String { store.id + threadId }
    }

    var body: some View {
        // A request comes before anything else: home turns to the computer that asks.
        let asking = model.asking
        Group {
            if let store = asking?.store ?? model.selected, model.pairing == nil || asking != nil {
                HomeView(
                    store: store, asking: asking?.request,
                    openConversation: { conversation = Conversation(store: store, threadId: $0) },
                    openComputers: { showsComputers = true })
            } else {
                PairingView()
            }
        }
        .presenceSurface()
        // The conversation is a sheet, pulled up from home and down again by its grabber.
        .sheet(item: $conversation) { conversation in
            ConversationView(store: conversation.store, threadId: conversation.threadId)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showsComputers) {
            ComputersView()
        }
        #if DEBUG
        .task {
            // The demo opens what it was asked to show.
            guard let store = model.selected else { return }
            if ["conversation", "empty", "history"].contains(Demo.scene) { conversation = Conversation(store: store, threadId: mainThread) }
            if Demo.scene == "computers" { showsComputers = true }
        }
        #endif
        .onChange(of: asking?.id) { _, id in
            if id != nil {
                conversation = nil
                showsComputers = false
            }
        }
    }
}
