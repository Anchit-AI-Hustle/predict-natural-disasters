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
            start.press(forDuration: 0.05, thenDragTo: end)
            n += 1
        }
        XCTAssertTrue(e.exists, "missing after scrolling: \(e)", file: file, line: line)
        return e
    }

    /// Opens a section: the tab bar (or its More list) on iPhone, the sidebar on iPad.
    func open(_ app: XCUIApplication, tab: String, title: String) {
        if isPad {
            let item = el(app, "sidebar-" + tab)
            if !item.exists {
                // Portrait iPad may hide the sidebar behind a button.
                for name in ["ToggleSidebar", "Show Sidebar", "Sections"] {
                    let toggle = app.navigationBars.buttons[name].firstMatch
                    if toggle.exists && toggle.isHittable { toggle.tap(); break }
                }
            }
            if item.waitForExistence(timeout: 5) { item.tap() } else {
                let cell = app.staticTexts[title]
                if cell.exists { cell.tap() }
            }
            // In portrait the sidebar floats over the page; close it so the page can be tapped.
            let dismiss = el(app, "PopoverDismissRegion")
            if dismiss.waitForExistence(timeout: 2) && dismiss.isHittable { dismiss.tap() }
            return
        }
        let button = app.tabBars.buttons[title]
        if button.exists { button.tap(); return }
        app.tabBars.buttons["More"].tap()
        let cell = app.tables.cells.staticTexts[title].firstMatch
        if cell.waitForExistence(timeout: 5) { cell.tap() } else { app.staticTexts[title].firstMatch.tap() }
    }

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
            ("alerts", "Alerts & events", "Current reports from official agencies. Open any alert to see its details and its source."),
            ("forecasts", "Forecasts", "Natural disaster forecasts"),
            ("places", "My places", "Your saved places, and the dangers reported near them."),
            ("map", "Map", "Live disaster map"),
            ("track", "Track record", "Track record")
        ]
        for (i, t) in tabs.enumerated() {
            open(app, tab: t.0, title: t.1)
            waitFor(app.staticTexts[t.2].firstMatch)
            if t.0 != "track" { waitFor(el(app, "trustNote")) }
            if t.0 == "track" { waitFor(el(app, "answerLead"), 60) }
            shot(app, String(format: "%02d-", i + 2) + t.0)
        }
    }

    func testDetailNavigationFromAlerts() {
        let app = launch()
        open(app, tab: "alerts", title: "Alerts & events")
        let card = el(app, "alertCard")
        scrollTo(app, card, hittable: true)
        card.tap()
        waitFor(el(app, "trustNote"))
        waitFor(app.staticTexts["OFFICIAL ALERT"].firstMatch)
        waitFor(el(app, "shareButton"))
        shot(app, "10-alert-from-list")
    }

    /// One screenshot per detail kind, opened as the site's own paths.
    func testEveryDetailKind() {
        let routes: [(String, String, String)] = [
            ("event", "/disasters/usgs-us7000efgh", "LIVE EVENT"),
            ("alert", "/alerts/gdacs-FL-1104999", "OFFICIAL ALERT"),
            ("calamity", "/calamities/gdacs-FL-1104999", "CURRENT DISASTER"),
            ("forecast", "/forecasts/OUT-gdacs-FL-1104999", "FORECAST DETAILS"),
            ("region", "/regions/Nepal", "Disasters in Nepal"),
            ("location", "/locations/Kathmandu?lat=27.7172&lon=85.324&level=City%20or%20town&country=Nepal&cc=NP", "Disasters near Kathmandu"),
            ("hazard", "/hazards/Flood", "Flood events"),
            ("history", "/history/mount-vesuvius-eruption", "Mount Vesuvius eruption"),
            ("source", "/sources/USGS", "USGS"),
            ("quiet", "/disasters/usgs-us7000ijkl", "LIVE EVENT"),
            ("notfound", "/disasters/no-such-record", "Event not found")
        ]
        for r in routes {
            let app = launch(["-PNDOpenRoute", r.1])
            waitFor(app.staticTexts[r.2].firstMatch, 30)
            if r.0 != "history" && r.0 != "notfound" { waitFor(el(app, "trustNote")) }
            if r.0 == "quiet" { waitFor(el(app, "quietNote")) }
            // The source page has no enrichment block (features.md 10.2).
            if r.0 != "notfound" && r.0 != "source" { scrollTo(app, el(app, "enrichment")) }
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
        open(app, tab: "alerts", title: "Alerts & events")
        waitFor(el(app, "feedError"))
        shot(app, "41-offline-alerts")
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
        waitFor(app2.staticTexts["OFFICIAL ALERT"].firstMatch, 30)
        shot(app2, "62-alert-detail-axl")
    }
}
