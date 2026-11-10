// A throwaway app to type into, so that the text tools can be checked on a
// real Mac without touching anyone's documents: one window, a single-line
// field and a multi-line text view. Nothing is ever saved.
//
// Build and run the check (see check.mjs):
//   swiftc -O -o "$TMPDIR/AgentOSTypingTest" test/typing-app/TypingApp.swift
//   pnpm build && node test/typing-app/check.mjs "$TMPDIR/AgentOSTypingTest"
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow!

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = makeMenu()

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 300), styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window.title = "Typing Test"

    let field = NSTextField(frame: NSRect(x: 20, y: 250, width: 380, height: 24))
    field.setAccessibilityTitle("Single line")
    field.placeholderString = "Single line"

    let scroll = NSScrollView(frame: NSRect(x: 20, y: 20, width: 380, height: 210))
    scroll.hasVerticalScroller = true
    scroll.borderType = .bezelBorder
    let text = NSTextView(frame: scroll.contentView.bounds)
    text.autoresizingMask = [.width]
    text.isRichText = false
    text.font = .systemFont(ofSize: 13)
    text.setAccessibilityTitle("Multi line")
    scroll.documentView = text

    window.contentView?.addSubview(field)
    window.contentView?.addSubview(scroll)
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(field)
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  /// Shortcuts such as Cmd+A only reach a text field through menu items.
  private func makeMenu() -> NSMenu {
    let main = NSMenu()
    let app = NSMenu()
    app.addItem(withTitle: "Quit Typing Test", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    for menu in [app, edit] {
      let item = NSMenuItem()
      item.submenu = menu
      main.addItem(item)
    }
    return main
  }
}

let delegate = AppDelegate()
let application = NSApplication.shared
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
