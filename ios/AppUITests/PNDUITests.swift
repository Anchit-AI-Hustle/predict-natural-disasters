import XCTest
import UIKit

/// UI tests run in fixture mode (`-PNDFixtureMode`): every request is answered
/// from the app bundle, so CI needs no network. Each test attaches
/// screenshots that the workflow exports as PNGs.
final class PNDUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-PNDFixtureMode"] + extra
        app.launch()
        return app
    }

    var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = (isPad ? "iPad" : "iPhone") + "-" + name
        a.lifetime = .keepAlways
        add(a)
    }

    func waitFor(_ e: XCUIElement, _ timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "missing: \(e)", file: file, line: line)
    }

    func el(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Scrolls the main content up until `e` exists (and, when `hittable`,
    /// can be tapped). Lazy stacks and lists only build rows near the screen,
    /// so anything below the fold has to be scrolled to. The drag runs along
    /// the right edge so it never pans the map card.
    @discardableResult
    func scrollTo(_ app: XCUIApplication, _ e: XCUIElement, hittable: Bool = false, swipes: Int = 15, down: Bool = false,
                  file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        _ = e.waitForExistence(timeout: 5)
        var n = 0
        // isHittable is already true when one edge of a row peeks in at the
        // bottom, so a tap target must sit well inside the window.
        func onScreen() -> Bool {
            guard e.isHittable else { return false }
            let w = app.windows.firstMatch.frame
            let f = e.frame
            return f.minY >= w.minY + 60 && min(f.maxY, f.minY + 120) <= w.maxY - 100
        }
        while !(e.exists && (!hittable || onScreen())) && n < swipes {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.985, dy: down ? 0.3 : 0.78))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.985, dy: down ? 0.78 : 0.3))
            // Holding at the end of the drag leaves no momentum, so a tap that
            // follows lands on a still page instead of only stopping the scroll.
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
            n += 1
        }
        if hittable && e.exists {
            // Wait until the element stops moving before anyone taps it.
            var last = e.frame
            for _ in 0..<10 {
                Thread.sleep(forTimeInterval: 0.3)
                let now = e.frame
                if now == last { break }
                last = now
            }
        }
        XCTAssertTrue(e.exists, "missing after scrolling: \(e)", file: file, line: line)
        return e
    }

    /// Opens a section: the five-tab bar on iPhone, the sidebar on iPad.
    func open(_ app: XCUIApplication, tab: String, title: String) {
        if isPad {
            let item = el(app, "sidebar-" + tab)
            if !(item.exists && item.isHittable) {
                // Portrait iPad may hide the sidebar behind a button.
                for name in ["ToggleSidebar", "Show Sidebar", "Sections"] {
                    let toggle = app.navigationBars.buttons[name].firstMatch
                    if toggle.exists && toggle.isHittable { toggle.tap(); break }
                }
            }
            if item.waitForExistence(timeout: 5) {
                if item.isHittable { item.tap() } else { item.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
            } else {
                let cell = app.staticTexts[title]
                if cell.exists { cell.tap() }
            }
            // In portrait the sidebar floats over the page; close it so the page can be tapped.
            let dismiss = el(app, "PopoverDismissRegion")
            if dismiss.waitForExistence(timeout: 2) && dismiss.isHittable { dismiss.tap() }
            return
        }
        let button = el(app, "tab-" + tab)
        waitFor(button)
        button.tap()
    }

    /// The site's five tabs, in its order (features.md section 0.1).
    let barTabs = ["map", "alerts", "forecasts", "places", "track"]

    func testHomeShowsTrustNoteAndFigures() {
        let app = launch()
        waitFor(el(app, "trustNote"))
        XCTAssertTrue(app.staticTexts["Experimental model, not an official warning."].exists)
        waitFor(app.staticTexts["Is a place you care about at risk?"])
        waitFor(el(app, "kpi-Live events"))
        shot(app, "01-home")
    }

    func testEveryTabRendersFromFixtures() {
        let app = launch()
        waitFor(el(app, "trustNote"))
        let tabs: [(String, String, String)] = [
            ("alerts", "Alerts & events", "Current reports from official agencies: events they have detected, and the warnings, watches and advisories they have issued. Open any report to see its details and its source."),
            ("forecasts", "Forecasts", "Natural disaster forecasts"),
            ("places", "My places", "Your saved places, and the dangers reported near them."),
            ("map", "Map", "Live disaster map"),
            ("track", "Track record", "Track record")
        ]
        for (i, t) in tabs.enumerated() {
            open(app, tab: t.0, title: t.1)
            // A query string is capped at 128 characters, so a long subtitle is matched by its start.
            waitFor(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", String(t.2.prefix(100)))).firstMatch)
            if t.0 != "track" { waitFor(el(app, "trustNote")) }
            if t.0 == "track" { waitFor(el(app, "answerLead"), 60) }
            shot(app, String(format: "%02d-", i + 2) + t.0)
        }
        // Home is reached from the logo, as on the site.
        let logo = el(app, "logoButton")
        waitFor(logo)
        logo.tap()
        waitFor(app.staticTexts["Is a place you care about at risk?"].firstMatch)
    }

    /// Five tabs and no system "More" tab: Map and Track record are never
    /// hidden behind one (iOS-only fix a). iPad shows the same five in its sidebar.
    func testFiveTabsAndNoSystemMoreTab() {
        let app = launch()
        waitFor(el(app, "trustNote"))
        if !isPad {
            for t in barTabs { waitFor(el(app, "tab-" + t), 10) }
            XCTAssertFalse(el(app, "tab-home").exists, "Home is not a tab")
            XCTAssertFalse(app.tabBars.buttons["More"].exists, "no system More tab")
        }
        open(app, tab: "track", title: "Track record")
        waitFor(app.staticTexts["Track record"].firstMatch)
        open(app, tab: "map", title: "Map")
        waitFor(app.staticTexts["Live disaster map"].firstMatch)
        shot(app, "05-five-tabs")
    }

    /// The map card's Key button is never covered: at 390 pt the layer switch
    /// took its row and covered it. It is reachable and opens the key, it does
    /// not sit under the tab bar, and every tab in the bar can be tapped.
    func testMapKeyAndEveryTabAreReachable() {
        let app = launch()
        waitFor(el(app, "trustNote"))
        open(app, tab: "map", title: "Map")
        waitFor(app.staticTexts["Live disaster map"].firstMatch)
        // The Key row can start well below the screen. The page is dragged from
        // high on the screen: a drag that starts on the map (just under the Key
        // row) pans the map, not the page.
        // Every map card has a Key button, and a tab kept in memory behind this
        // one (Home's map) has one too, so the Map page's own button is the one
        // that comes on screen as the page scrolls.
        let keys = app.buttons.matching(identifier: "mapKeyButton")
        waitFor(keys.firstMatch)
        let win = app.windows.firstMatch.frame
        func shown() -> XCUIElement? {
            keys.allElementsBoundByIndex.first { $0.exists && $0.frame.minY >= win.minY + 60 && $0.frame.maxY <= win.maxY - 130 }
        }
        var drags = 0
        while shown() == nil && drags < 12 {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.3)
            drags += 1
        }
        guard let key = shown() else {
            XCTFail("no Key button came on screen after \(drags) drags: " + keys.allElementsBoundByIndex.map { "\($0.frame)" }.joined(separator: " "))
            return
        }
        Thread.sleep(forTimeInterval: 0.5)
        shot(app, "map-key-row")
        if !key.isHittable {
            // Name what sits over the button, so a failure says what covers it.
            let c = CGPoint(x: key.frame.midX, y: key.frame.midY)
            let kinds: [XCUIElement.ElementType] = [.other, .button, .staticText, .scrollView, .map, .image, .segmentedControl]
            var over: [String] = []
            for k in kinds {
                for e in app.descendants(matching: k).allElementsBoundByIndex.prefix(400) where e.exists && e.frame.contains(c) {
                    over.append("\(k.rawValue):\(e.identifier):\(e.label.prefix(30)):\(e.frame)")
                }
            }
            XCTFail("the Key button is covered at \(c) after \(drags) drags; elements there: " + over.joined(separator: " | "))
        }
        if !isPad {
            let bar = el(app, "tabBar")
            waitFor(bar)
            XCTAssertFalse(key.frame.intersects(bar.frame), "the Key button is under the tab bar")
            for t in barTabs { XCTAssertTrue(el(app, "tab-" + t).isHittable, "tab \(t) cannot be reached") }
        }
        key.tap()
        waitFor(el(app, "mapKey"), 5)
        shot(app, "map-key")
    }

    /// Alerts shows 40 at a time and says so (changelog C6, vectors alerts.pager).
    func testAlertsPager() {
        let app = launch(["-PNDFixturePager"])
        open(app, tab: "alerts", title: "Alerts & events")
        waitFor(el(app, "alertCard"))
        let more = el(app, "showMore")
        scrollTo(app, more, hittable: true, swipes: 60)
        XCTAssertEqual(more.label, "Show 5 more")
        XCTAssertTrue(app.staticTexts["Showing 40 of 45."].exists)
        shot(app, "12-alerts-pager")
        more.tap()
        let all = app.staticTexts["Showing all 45."].firstMatch
        scrollTo(app, all, swipes: 20)
        XCTAssertFalse(el(app, "showMore").exists)
        shot(app, "13-alerts-pager-all")
    }

    /// The ND-001 check shows all eight rows (changelog C11, vectors verificationDetail.render).
    func testForecastCheckEightRows() {
        let app = launch(["-PNDOpenRoute", "/verification-detail"])
        waitFor(app.staticTexts["ND-001 \u{00B7} Central Vietnam flood and landslide forecast"].firstMatch, 30)
        waitFor(el(app, "trustNote"))
        let metrics = ["Area", "Start date", "Start time", "Duration", "How widespread", "Strength or severity", "Lives lost", "Missing people"]
        for (i, m) in metrics.enumerated() {
            let row = el(app, "compareRow-\(i)")
            scrollTo(app, row)
            XCTAssertTrue(row.staticTexts[m].exists, "row \(i) is \(m)")
        }
        XCTAssertFalse(el(app, "compareRow-8").exists, "eight rows, no more")
        shot(app, "70-forecast-check")
    }

    func testDetailNavigationFromAlerts() {
        let app = launch()
        open(app, tab: "alerts", title: "Alerts & events")
        let card = el(app, "alertCard")
        scrollTo(app, card, hittable: true)
        card.tap()
        waitFor(el(app, "trustNote"))
        // C45: a report opens at /disasters/ whatever its level; C39: its eyebrow follows the evidence.
        waitFor(app.staticTexts.matching(NSPredicate(format: "label == 'REPORTED EVENT' OR label BEGINSWITH 'OFFICIAL '")).firstMatch)
        waitFor(el(app, "shareButton"))
        shot(app, "10-alert-from-list")
    }

    /// One screenshot per detail kind, opened as the site's own paths.
    func testEveryDetailKind() {
        let routes: [(String, String, String)] = [
            // C39: an observed report's eyebrow is "REPORTED EVENT", and an alert page that is not a warning says whose report it is.
            ("event", "/disasters/usgs-us7000efgh", "REPORTED EVENT"),
            ("alert", "/alerts/gdacs-FL-1104999", "REPORT FROM AN OFFICIAL AGENCY"),
            ("calamity", "/calamities/gdacs-FL-1104999", "CURRENT DISASTER"),
            ("forecast", "/forecasts/OUT-gdacs-FL-1104999", "FORECAST DETAILS"),
            ("region", "/regions/Nepal", "Disasters in Nepal"),
            ("location", "/locations/Kathmandu?lat=27.7172&lon=85.324&level=City%20or%20town&country=Nepal&cc=NP", "Disasters near Kathmandu"),
            ("hazard", "/hazards/Flood", "Flood events"),
            ("history", "/history/mount-vesuvius-eruption", "Mount Vesuvius eruption"),
            ("source", "/sources/USGS", "USGS"),
            ("quiet", "/disasters/usgs-us7000ijkl", "EVENT NO LONGER UPDATED"),
            ("notfound", "/disasters/no-such-record", "Event not found")
        ]
        for r in routes {
            let app = launch(["-PNDOpenRoute", r.1])
            waitFor(app.staticTexts[r.2].firstMatch, 30)
            if r.0 != "history" && r.0 != "notfound" { waitFor(el(app, "trustNote")) }
            if r.0 == "quiet" { waitFor(el(app, "quietNote")) }
            // The source page has no enrichment block (features.md 10.2).
            // The source page has none either, and a history page is the archive, with no live enrichment (C46).
            if r.0 != "notfound" && r.0 != "source" && r.0 != "history" { scrollTo(app, el(app, "enrichment")) }
            shot(app, "20-detail-" + r.0)
            app.terminate()
        }
    }

    func testSearchAndSavePlace() {
        let app = launch()
        let field = app.textFields["Search city, area or address"]
        waitFor(field)
        field.tap()
        field.typeText("Kathmandu\n")
        let candidate = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Kathmandu'")).firstMatch
        waitFor(candidate)
        candidate.tap()
        waitFor(el(app, "placeResult"))
        scrollTo(app, el(app, "placeWhy"))
        shot(app, "30-place-result")
        let save = el(app, "savePlace")
        scrollTo(app, save, hittable: true)
        save.tap()
        waitFor(app.staticTexts["Saved. You can find it on the My places page."])
        open(app, tab: "places", title: "My places")
        scrollTo(app, el(app, "savedPlace"))
        shot(app, "31-my-places-saved")
    }

    func testOfflineShowsTheSiteWording() {
        let app = launch(["-PNDFixtureFail"])
        waitFor(el(app, "feedError"))
        XCTAssertTrue(app.staticTexts["Live data unavailable. Trying again automatically."].firstMatch.exists)
        waitFor(app.staticTexts["The live data did not load, so no update time can be shown"].firstMatch)
        shot(app, "40-offline-home")
        scrollTo(app, el(app, "unavailableCard"))
        open(app, tab: "alerts", title: "Alerts & events")
        waitFor(el(app, "feedError"))
        scrollTo(app, el(app, "unavailableCard"))
        shot(app, "41-offline-alerts")
    }

    /// A failed first load is not an all-clear for the reader's own place
    /// (changelog C26): Home and My places say the data is unavailable.
    func testFailedFeedIsNotAnAllClear() {
        let app = launch(["-PNDFixtureFail", "-PNDFixturePlaces"])
        let card = el(app, "placeResult")
        waitFor(card, 30)
        waitFor(card.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Live data unavailable")).firstMatch, 30)
        let allClear = NSPredicate(format: "label CONTAINS[c] 'Nothing reported nearby'")
        XCTAssertEqual(app.descendants(matching: .any).matching(allClear).count, 0, "no false all-clear on Home")
        scrollTo(app, el(app, "lastChecked"))
        XCTAssertEqual(el(app, "lastChecked").label, "not yet: the latest data could not be loaded")
        shot(app, "42-offline-place-answer")
        open(app, tab: "places", title: "My places")
        let chip = el(app, "placeChip")
        scrollTo(app, chip)
        XCTAssertTrue(chip.label.contains("LIVE DATA UNAVAILABLE"), chip.label)
        XCTAssertEqual(app.descendants(matching: .any).matching(allClear).count, 0, "no false all-clear on My places")
        shot(app, "43-offline-my-places")
    }

    func testMoreScreenAndSettings() {
        let app = launch()
        let more = el(app, "moreButton")
        waitFor(more)
        more.tap()
        waitFor(el(app, "moreScreen"))
        shot(app, "50-more")
        let settings = app.buttons["Settings and time zone"].firstMatch
        scrollTo(app, el(app, "footerAgencies"))
        shot(app, "52-more-footer")
        scrollTo(app, settings, hittable: true, down: true)
        settings.tap()
        waitFor(el(app, "settingsScreen"))
        shot(app, "51-settings")
    }

    func testAccessibilityExtraLargeText() {
        let app = launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"])
        waitFor(el(app, "trustNote"))
        shot(app, "60-home-axl")
        open(app, tab: "alerts", title: "Alerts & events")
        scrollTo(app, el(app, "alertCard"))
        shot(app, "61-alerts-axl")
        let app2 = launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL", "-PNDOpenRoute", "/alerts/gdacs-FL-1104999"])
        waitFor(app2.staticTexts["REPORT FROM AN OFFICIAL AGENCY"].firstMatch, 30)
        shot(app2, "62-alert-detail-axl")
    }
}
