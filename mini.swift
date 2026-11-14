// Jarvis Mini: a transparent, always-on-top desktop widget that shows http://localhost:4199/?mini=1.
// Build with ./build-mini.sh
import Cocoa
import WebKit

final class Delegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKScriptMessageHandler {
  var panel: NSPanel!

  func applicationDidFinishLaunching(_ note: Notification) {
    let size = NSSize(width: 230, height: 400)
    let screen = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
    panel = NSPanel(
      contentRect: NSRect(x: screen.maxX - size.width - 24, y: screen.minY + 24, width: size.width, height: size.height),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

    let config = WKWebViewConfiguration()
    config.mediaTypesRequiringUserActionForPlayback = []
    config.userContentController.add(self, name: "drag")
    config.userContentController.add(self, name: "quit")
    let web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
    web.setValue(false, forKey: "drawsBackground") // lets the desktop show through
    web.uiDelegate = self
    web.load(URLRequest(url: URL(string: "http://localhost:4199/?mini=1")!))
    panel.contentView = web
    panel.orderFrontRegardless()
  }

  // The page asks to be dragged (mouse down on the head) or closed (× button).
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "quit" { NSApp.terminate(nil) }
    if message.name == "drag", let event = NSApp.currentEvent { panel.performDrag(with: event) }
  }

  // Microphone: only the local Jarvis page may use it. macOS still asks the user once for the app itself.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == "localhost" && type == .microphone ? .grant : .deny)
  }

  // confirm() from the page: the on-screen approval for dangerous tools.
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = "Jarvis"
    alert.informativeText = message
    alert.addButton(withTitle: "Benarkan")
    alert.addButton(withTitle: "Tolak")
    NSApp.activate(ignoringOtherApps: true)
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // no Dock icon
app.run()
