// Developer tool: pictures of a Jarvis face page, to check faces by eye without a browser window.
// Build: swiftc -O dev/snap.swift -o /tmp/snap
// Use:   /tmp/snap <url> <out-prefix> [javascript]
// Saves <out-prefix>-rest.png, then makes the face speak for 1.5 s and saves <out-prefix>-open.png.
import Cocoa
import WebKit

let args = CommandLine.arguments
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
// Nearly invisible but on screen: a hidden window would stop the page from drawing.
let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 600), styleMask: [.borderless], backing: .buffered, defer: false)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 600))
win.contentView = web
win.alphaValue = 0.02
win.level = .floating
win.orderFrontRegardless()
web.load(URLRequest(url: URL(string: args[1])!))

func shot(_ name: String, then: @escaping () -> Void) {
  web.evaluateJavaScript("window.FacePoly.snapshot()") { r, e in
    let b64 = (r as? String ?? "").components(separatedBy: ",").last ?? ""
    try? Data(base64Encoded: b64)?.write(to: URL(fileURLWithPath: args[2] + name + ".png"))
    if r == nil { print("error", e ?? "nil") }
    then()
  }
}

DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
  if args.count > 3 { web.evaluateJavaScript(args[3]) { r, e in print("js", r ?? e ?? "nil") } }
  shot("-rest") {
    web.evaluateJavaScript("setInterval(() => window.FacePoly.setSpeechLevel(1, .5), 30); window.FacePoly.ready") { r, _ in
      print("ready", r ?? "nil")
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { shot("-open") { exit(0) } }
    }
  }
}
app.run()
