// The aquarium as a desktop wallpaper.
//
// One borderless window per screen sits at the desktop window level: above the still
// wallpaper picture, below the desktop icons, so files and folders stay on top of the
// water and keep working normally. The scene comes from a web view fed by the copy of
// the aquarium inside this app bundle, served over a private scheme so its module
// imports resolve the way they do from a web server.
//
// The window never takes mouse events. The pointer reaches the fish another way: the
// global cursor position is read on a timer and handed to the page as a pointer move,
// so clicking and dragging on the desktop still belongs to the Finder.

import Cocoa
import WebKit
import IOKit.ps

let sceneScheme = "desktop-habitats"
let sceneHost = "local"
let scenePage = "/scenes/riverscape/wallpaper.html"

/// Serves the bundled copy of the aquarium to the web view.
final class SceneHandler: NSObject, WKURLSchemeHandler {
  private let root: URL
  private static let types = [
    "html": "text/html",
    "js": "text/javascript",
    "css": "text/css",
    "json": "application/json",
    "jpg": "image/jpeg",
    "png": "image/png",
  ]

  init(root: URL) { self.root = root.standardizedFileURL }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let path = url.path == "" || url.path == "/" ? scenePage : url.path
    let file = root.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(
        NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
      return
    }
    let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    task.didReceive(
      URLResponse(
        url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: nil))
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Puts whatever the page complains about into the agent's log.
final class Reporter: NSObject, WKScriptMessageHandler {
  static let shared = Reporter()
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    NSLog("desktop-habitats page: \(message.body)")
  }
}

/// A window that keeps the exact frame it is given. AppKit insets ordinary windows from
/// the screen edges; a wallpaper has to reach them.
final class DesktopWindow: NSWindow {
  override func constrainFrameRect(_ rect: NSRect, to screen: NSScreen?) -> NSRect { rect }
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

/// One screen's worth of aquarium.
final class Wallpaper: NSObject, WKNavigationDelegate {
  let window: DesktopWindow
  let view: WKWebView
  private var loaded = false
  private var inside = false
  private var rate = 0
  private var battery = false

  init(screen: NSScreen, root: URL) {
    let settings = WKWebViewConfiguration()
    settings.setURLSchemeHandler(SceneHandler(root: root), forURLScheme: sceneScheme)
    settings.suppressesIncrementalRendering = true
    // The page holds no state worth keeping between runs and should never leave traces.
    settings.websiteDataStore = .nonPersistent()
    // The agent has no window to look at, so anything the page reports goes to the log.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: """
          const report = (text) => webkit.messageHandlers.report.postMessage(String(text));
          for (const level of ['error', 'warn']) {
            const original = console[level];
            console[level] = (...parts) => {
              report(parts.map((part) => part && part.stack ? part.stack : part).join(' '));
              original.apply(console, parts);
            };
          }
          addEventListener('error', (event) =>
            report(`${event.message} at ${event.filename}:${event.lineno}`));
          addEventListener('unhandledrejection', (event) => report(event.reason));
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // A pointer move the page can read, sent from the global cursor position.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: """
          window.habitatPointerCount = 0;
          window.habitatPointer = (x, y) => {
            const canvas = document.querySelector('#scene');
            window.habitatPointerCount++;
            if (canvas)
              canvas.dispatchEvent(
                new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
          };
          window.habitatPointerOut = () => {
            const canvas = document.querySelector('#scene');
            if (canvas) canvas.dispatchEvent(new PointerEvent('pointerleave'));
          };
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true))

    view = WKWebView(frame: screen.frame, configuration: settings)
    settings.userContentController.add(Reporter.shared, name: "report")
    // WebKit stops a page whose window it thinks is covered, and AppKit never reports a
    // background agent's window as visible, so the scene would never start. This asks
    // WebKit not to make that call; the agent works out what is covered instead.
    if view.responds(to: NSSelectorFromString("setWindowOcclusionDetectionEnabled:"))
      || view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
    {
      view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
    }
    view.underPageBackgroundColor = NSColor(
      calibratedRed: 0.031, green: 0.055, blue: 0.047, alpha: 1)
    view.autoresizingMask = [.width, .height]

    window = DesktopWindow(
      contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false,
      screen: screen)
    super.init()

    view.navigationDelegate = self
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.ignoresMouseEvents = true
    window.isOpaque = true
    window.hasShadow = false
    window.backgroundColor = NSColor(calibratedRed: 0.031, green: 0.055, blue: 0.047, alpha: 1)
    window.isReleasedWhenClosed = false
    window.contentView = view
    // Hiding the agent, or another app's "Hide Others", must not take the water away.
    window.canHide = false
    window.setFrame(screen.frame, display: true)
    window.orderFrontRegardless()

    view.load(URLRequest(url: URL(string: "\(sceneScheme)://\(sceneHost)\(scenePage)")!))
  }

  func close() {
    NotificationCenter.default.removeObserver(self)
    view.navigationDelegate = nil
    view.configuration.userContentController.removeAllUserScripts()
    view.configuration.userContentController.removeScriptMessageHandler(forName: "report")
    view.removeFromSuperview()
    window.contentView = nil
    window.orderOut(nil)
    window.close()
  }

  /// Send only state changes. didFinish resends once after navigation, so there is no
  /// need to cross the WebKit process boundary every second with an unchanged rate.
  @discardableResult
  func setRate(_ wanted: Int) -> Bool {
    guard wanted != rate else { return false }
    rate = wanted
    if rate == 0 && inside {
      if loaded { view.evaluateJavaScript("habitatPointerOut()") }
      inside = false
    }
    NSLog("desktop-habitats: \(rate) fps")
    send()
    return true
  }

  func setPower(_ onBattery: Bool) {
    guard battery != onBattery else { return }
    battery = onBattery
    send()
  }

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript(
      """
      typeof habitatPower === 'function' && habitatPower(\(battery ? "true" : "false"));
      typeof habitatRate === 'function' && habitatRate(\(rate));
      """)
  }

  /// A pinch of food on the water, asked for from the menu rather than by clicking. The
  /// window never takes a mouse event, so there is no cursor position to drop it at: the
  /// page picks its own spot on the surface. Nothing is sent while the scene is stopped,
  /// where the food would only pile up unseen until it started again.
  func feed() {
    guard loaded, rate > 0 else { return }
    view.evaluateJavaScript("typeof habitatFeed === 'function' && habitatFeed()")
  }

  /// A cursor position in this screen's coordinates, or nil when the cursor left it.
  func setPointer(_ point: NSPoint?) {
    guard loaded, rate > 0 else { return }
    guard let point else {
      if inside { view.evaluateJavaScript("habitatPointerOut()") }
      inside = false
      return
    }
    inside = true
    view.evaluateJavaScript(
      "habitatPointer(\(String(format: "%.1f", point.x)),\(String(format: "%.1f", point.y)))")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded = true
    send()
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    NSLog("desktop-habitats: the scene did not load: \(error.localizedDescription)")
  }

  /// What the page thinks it is doing, for the log.
  func probe() {
    view.evaluateJavaScript(
      """
      (() => {
        const canvas = document.querySelector('#scene');
        const context = canvas && canvas.getContext('webgl2');
        return JSON.stringify({
          pixels: canvas && [canvas.width, canvas.height],
          covered: !document.querySelector('#loading').hidden,
          webgl2: Boolean(context),
          gpu: context && context.getParameter(context.RENDERER),
          hidden: document.hidden,
          pointers: window.habitatPointerCount,
        });
      })()
      """
    ) { value, error in
      NSLog("desktop-habitats page state: \(value ?? error?.localizedDescription ?? "unreadable")")
    }
  }

  /// What this screen is showing right now. The agent has no window of its own to look
  /// at, so this is how it can be checked.
  func snapshot(to file: URL, then done: @escaping () -> Void) {
    view.takeSnapshot(with: nil) { image, _ in
      defer { done() }
      guard let image, let data = image.tiffRepresentation,
        let png = NSBitmapImageRep(data: data)?.representation(using: .png, properties: [:])
      else { return }
      try? png.write(to: file)
      NSLog("desktop-habitats: wrote \(file.path)")
    }
  }
}

final class Controller: NSObject, NSApplicationDelegate, NSMenuDelegate {
  static var shared: Controller?
  private var screens: [Wallpaper] = []
  private var root = Bundle.main.resourceURL!.appendingPathComponent("scene")
  private var awake = true
  private var layout: [CGRect] = []
  private var lastPoint = NSPoint(x: -1e4, y: -1e4)
  private var snapshots: DispatchSourceSignal?
  private var status: NSStatusItem?
  private let state = NSMenuItem()
  private let pause = NSMenuItem()
  private let feed = NSMenuItem()
  private var applied = 0
  private var pointerTimer: Timer?
  private var pointerRate = 0
  private var exposureTimer: Timer?
  /// The choice outlives a restart, so a paused tank is still paused after logging in.
  /// Until one has been made there is nothing under the key at all, which is what lets a
  /// machine that asks for less motion start still without overruling anybody who has
  /// since decided otherwise.
  private var stopped =
    UserDefaults.standard.object(forKey: "paused") as? Bool ?? reduceMotion
  /// The fastest clearly-visible drawing may go, chosen from the Frame Rate menu.
  /// Lower is cooler and quieter. Like the paused choice, it outlives a restart.
  /// Only values the menu itself writes are ever stored, so no clamping is needed
  /// on the way in.
  private var maxFps = UserDefaults.standard.object(forKey: "maxFps") as? Int ?? 60
  private let fpsMenu = NSMenu()
  private var lowPower: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }
  /// Reduce Motion is a durable choice about the whole machine, not a passing shortage
  /// like Low Power Mode, so it decides how the wallpaper starts and never more than that:
  /// somebody who installed an animated wallpaper is allowed to want it anyway.
  private static var reduceMotion: Bool {
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  }
  private var reduceMotion: Bool { Controller.reduceMotion }

  func applicationDidFinishLaunching(_ note: Notification) {
    Controller.shared = self
    build()
    addMenu()

    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)

    // Drawing while the display is off, asleep or locked would only cost power.
    let workspace = NSWorkspace.shared.notificationCenter
    for (name, value) in [
      (NSWorkspace.screensDidSleepNotification, false),
      (NSWorkspace.screensDidWakeNotification, true),
      (NSWorkspace.sessionDidResignActiveNotification, false),
      (NSWorkspace.sessionDidBecomeActiveNotification, true),
    ] {
      workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }
    let distributed = DistributedNotificationCenter.default()
    for (name, value) in [("com.apple.screenIsLocked", false), ("com.apple.screenIsUnlocked", true)]
    {
      distributed.addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }

    // Low Power Mode holds the scene still, like any other reason not to draw.
    NotificationCenter.default.addObserver(
      forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
    ) { [weak self] _ in self?.applyRate() }

    // Turning Reduce Motion on mid-session stops the water for the same reason it starts
    // stopped under it, unless the tank has already been asked for deliberately.
    workspace.addObserver(
      forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self, UserDefaults.standard.object(forKey: "paused") == nil else { return }
      self.stopped = self.reduceMotion
      self.applyRate()
    }

    // Running on the battery halves the frame rate; the scene is slow enough to hold up.
    if let source = IOPSNotificationCreateRunLoopSource({ _ in
      DispatchQueue.main.async { Controller.shared?.applyRate() }
    }, nil)?.takeRetainedValue() {
      CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
    }

    // `kill -USR1` writes what the first screen is showing to /tmp/desktop-habitats.png.
    signal(SIGUSR1, SIG_IGN)
    snapshots = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    snapshots?.setEventHandler { [weak self] in self?.snapshot() }
    snapshots?.resume()
  }

  /// Draws for a moment even if the desktop is covered, then saves the frame.
  private func snapshot() {
    guard let first = screens.first else { return }
    for screen in screens { screen.setRate(60) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      first.probe()
      first.snapshot(to: URL(fileURLWithPath: "/tmp/desktop-habitats.png")) {
        self?.applyRate()
      }
    }
  }

  // Putting a full-screen window on a screen is itself a screen-parameter change, so the
  // arrangement is compared before anything is rebuilt.
  @objc private func screensChanged() {
    guard NSScreen.screens.map(\.frame) != layout else { return }
    build()
  }

  private func build() {
    layout = NSScreen.screens.map(\.frame)
    for screen in screens { screen.close() }
    screens = NSScreen.screens.map { Wallpaper(screen: $0, root: root) }
    applyRate()
  }

  private var onBattery: Bool {
    guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
      let kind = IOPSGetProvidingPowerSourceType(blob)?.takeRetainedValue() as String?
    else { return false }
    return kind == kIOPSBatteryPowerValue
  }

  /// Full speed while the wallpaper is in plain sight, a slow beat when windows leave only
  /// part of it showing, and nothing at all behind a full screen of work or a dark display.
  /// Power depends on the machine and display; it must be measured on the target Mac.
  func applyRate() {
    let battery = onBattery
    // A sustained 60 fps never lets the GPU idle, which is what spins a laptop fan:
    // every display renders the scene separately. A lower menu setting halves the
    // work and leaves idle time between frames. Battery never exceeds 30, as before.
    let full = battery ? min(maxFps, 30) : maxFps
    let still = stopped || lowPower || !awake
    // Read the window list once for all displays, and never while deliberately still.
    let blockers = still ? [] : windowBlockers()
    applied = 0
    var changed = false
    for (index, screen) in screens.enumerated() {
      let showing = index < layout.count ? exposure(layout[index], blockers: blockers) : 1
      let rate = still || showing < 0.15 ? 0 : showing < 0.4 ? 20 : full
      screen.setPower(battery)
      if screen.setRate(rate) { changed = true }
      applied = max(applied, rate)
    }
    if changed { lastPoint = NSPoint(x: -1e4, y: -1e4) }
    updateTimers(pollExposure: !still)
  }

  private func updateTimers(pollExposure: Bool) {
    // Pointer sampling need not outrun the animation, nor wake a stopped wallpaper.
    let wanted = min(30, applied)
    if wanted != pointerRate {
      pointerTimer?.invalidate()
      pointerTimer = nil
      pointerRate = wanted
      if wanted > 0 {
        let timer = Timer.scheduledTimer(withTimeInterval: 1.0 / Double(wanted), repeats: true) { [weak self] _ in
          self?.trackPointer()
        }
        timer.tolerance = 0.003
        pointerTimer = timer
      }
    }
    if !pollExposure {
      exposureTimer?.invalidate()
      exposureTimer = nil
    } else if exposureTimer == nil {
      // Continue this low-frequency check while merely covered so uncovering resumes.
      let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
        self?.applyRate()
      }
      timer.tolerance = 0.25
      exposureTimer = timer
    }
  }

  /// How much of a screen ordinary windows leave uncovered, from none to all of it.
  /// AppKit's own occlusion never reports this agent's windows as visible, hence the
  /// direct look at what is on screen.
  private func windowBlockers() -> [CGRect] {
    guard
      let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
        as? [[String: Any]]
    else { return [] }
    let me = ProcessInfo.processInfo.processIdentifier
    // Only ordinary app windows count. The menu bar, the Dock and other system layers
    // hold full-screen windows that are almost entirely transparent.
    return list.compactMap { info -> CGRect? in
      guard info[kCGWindowLayer as String] as? Int == 0,
        info[kCGWindowOwnerPID as String] as? Int32 != me,
        info[kCGWindowAlpha as String] as? Double ?? 0 > 0.95,
        let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
      else { return nil }
      return CGRect(dictionaryRepresentation: bounds as CFDictionary)
    }
  }

  private func exposure(_ frame: CGRect, blockers: [CGRect]) -> Double {
    guard !blockers.isEmpty else { return 1 }
    let flipped = CGRect(
      x: frame.minX, y: (NSScreen.screens.first?.frame.height ?? frame.maxY) - frame.maxY,
      width: frame.width, height: frame.height)
    let columns = 16, rows = 10
    var free = 0
    for column in 0..<columns {
      for row in 0..<rows {
        let point = CGPoint(
          x: flipped.minX + flipped.width * (Double(column) + 0.5) / Double(columns),
          y: flipped.minY + flipped.height * (Double(row) + 0.5) / Double(rows))
        if !blockers.contains(where: { $0.contains(point) }) { free += 1 }
      }
    }
    return Double(free) / Double(columns * rows)
  }

  // MARK: - The menu bar

  /// The agent's only visible piece: a fish in the menu bar that can stop the water.
  private func addMenu() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let symbol = NSImage(systemSymbolName: "fish", accessibilityDescription: "Desktop Habitats")
    symbol?.isTemplate = true
    item.button?.image = symbol
    if symbol == nil { item.button?.title = "Desktop Habitats" }
    item.button?.toolTip = "Desktop Habitats · Riverscape"

    let menu = NSMenu()
    menu.delegate = self
    // The items say for themselves when they are available; AppKit's own guess would
    // leave Pause enabled in Low Power Mode, where pressing it would do nothing.
    menu.autoenablesItems = false
    state.isEnabled = false
    menu.addItem(state)
    menu.addItem(.separator())
    feed.title = "Feed"
    feed.target = self
    feed.action = #selector(feedFish)
    menu.addItem(feed)
    pause.target = self
    pause.action = #selector(togglePause)
    menu.addItem(pause)
    let fps = NSMenuItem(title: "Frame Rate", action: nil, keyEquivalent: "")
    for rate in [60, 30, 20] {
      let option = NSMenuItem(
        title: "\(rate) fps", action: #selector(setMaxFps(_:)), keyEquivalent: "")
      option.target = self
      option.representedObject = rate
      fpsMenu.addItem(option)
    }
    fps.submenu = fpsMenu
    menu.addItem(fps)
    menu.addItem(.separator())
    let leave = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
    leave.target = self
    menu.addItem(leave)
    item.menu = menu
    status = item
    if item.button?.window == nil || !item.isVisible {
      NSLog("desktop-habitats: the menu bar item did not appear")
    }
  }

  /// Says what the wallpaper is doing, and why, whenever the menu is opened. Most of the
  /// reasons it holds still are deliberate, and unexplained stillness reads as a fault.
  func menuNeedsUpdate(_ menu: NSMenu) {
    state.title =
      lowPower
      ? "Still, for Low Power Mode"
      : stopped
        ? reduceMotion ? "Paused, for Reduce Motion" : "Paused"
        : !awake
          ? "Still, the screen is off"
          : applied == 0
            ? "Resting behind your windows"
            : "Running at \(applied) frames a second"
    pause.title = stopped ? "Resume" : "Pause"
    // In Low Power Mode nothing is going to draw, so the item would be a false promise.
    // Reduce Motion is not the same case: the machine can perfectly well draw, it has
    // merely been asked not to, and Resume is how somebody says they want this one anyway.
    pause.isEnabled = !lowPower
    // Food that nothing is going to draw would sit in still water until the tank started
    // again and then all arrive at once, so Feed says so rather than promising a feeding.
    feed.isEnabled = applied > 0
    for option in fpsMenu.items {
      option.state = (option.representedObject as? Int == maxFps) ? .on : .off
    }
  }

  /// Every screen, because each one runs its own tank with its own fish rather than one
  /// scene stretched across them: feeding only the screen the menu bar happens to be on
  /// would leave the others watching an unfed aquarium.
  @objc private func feedFish() {
    for screen in screens { screen.feed() }
  }

  @objc private func togglePause() {
    stopped.toggle()
    UserDefaults.standard.set(stopped, forKey: "paused")
    applyRate()
  }

  @objc private func setMaxFps(_ sender: NSMenuItem) {
    guard let rate = sender.representedObject as? Int, [60, 30, 20].contains(rate) else {
      return
    }
    maxFps = rate
    UserDefaults.standard.set(rate, forKey: "maxFps")
    applyRate()
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }

  /// The cursor belongs to the Finder, so its position is read rather than captured.
  private func trackPointer() {
    let point = NSEvent.mouseLocation
    guard abs(point.x - lastPoint.x) > 0.2 || abs(point.y - lastPoint.y) > 0.2 else { return }
    lastPoint = point
    for (index, screen) in NSScreen.screens.enumerated() where index < screens.count {
      let frame = screen.frame
      screens[index].setPointer(
        frame.contains(point)
          ? NSPoint(x: point.x - frame.minX, y: frame.maxY - point.y) : nil)
    }
  }
}

let application = NSApplication.shared
let controller = Controller()
application.setActivationPolicy(.accessory)
application.delegate = controller
application.run()
