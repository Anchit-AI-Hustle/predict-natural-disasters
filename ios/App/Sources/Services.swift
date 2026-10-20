import Foundation
import SwiftUI
import UserNotifications
import BackgroundTasks
import CoreLocation
import PNDCore

/// On-device alerts (features.md section 16.3). `/api/alerts` is Web Push
/// only and switched off in production, so the app evaluates the site's own
/// alert rules itself: in the foreground on every feed load, and in a
/// BGAppRefreshTask whenever iOS chooses to run one. Places never leave the
/// device.
final class NotificationService: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = NotificationService()
    static let taskID = "com.anchittandon.pnd.refresh"

    /// Set by the app so a tapped notification can open its screen.
    var onOpen: ((URL) -> Void)?

    func configure() {
        UNUserNotificationCenter.current().delegate = self
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskID, using: nil) { task in
            guard let t = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
            self.handle(t)
        }
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    /// Asks iOS for a background refresh at least 15 minutes from now. iOS
    /// decides when (or whether) it actually runs.
    func scheduleBackgroundRefresh(enabled: Bool) {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskID)
        guard enabled else { return }
        let req = BGAppRefreshTaskRequest(identifier: Self.taskID)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(req)
    }

    private func handle(_ task: BGAppRefreshTask) {
        let on = UserDefaults.standard.bool(forKey: "pnd_alerts_on")
        scheduleBackgroundRefresh(enabled: on)
        guard on else { task.setTaskCompleted(success: true); return }
        let work = Task {
            let ok = await Self.checkNow()
            task.setTaskCompleted(success: ok)
        }
        task.expirationHandler = { work.cancel() }
    }

    /// Fetches the feed and posts what the alert rules allow: place alerts
    /// for saved places and the major global events, which need no place
    /// (features.md section 16.3). Returns success.
    static func checkNow() async -> Bool {
        let places = PlacesStore().places
        do {
            let (feed, data) = try await APIClient().events(fresh: false)
            FeedCache.defaultCache().save(data)
            UserDefaults.standard.set(JSDate.iso(Date().timeIntervalSince1970 * 1000), forKey: "pnd_alerts_last_check")
            await post(events: feed.live, places: places)
            return true
        } catch { return false }
    }

    static func post(events: [Record], places: [Place]) async {
        let memory = NotificationMemory()
        let now = Date().timeIntervalSince1970 * 1000
        let plan = AlertRules.plan(events: events, places: places, seen: memory.seen, now: now)
        memory.seen = plan.seen
        for a in plan.toSend {
            let c = UNMutableNotificationContent()
            c.title = a.title
            c.body = a.body
            c.sound = .default
            c.threadIdentifier = a.tag
            c.userInfo = ["url": a.url]
            // The same tag replaces the previous notification, as on the web.
            let req = UNNotificationRequest(identifier: a.tag, content: c, trigger: nil)
            try? await UNUserNotificationCenter.current().add(req)
        }
    }

    /// Foreground evaluation on every feed load, as the site's
    /// `evaluateRiskNotifications` does on /alerts and every other feed page
    /// (features.md section 16.2): whenever notifications are allowed, with or
    /// without saved places. Place alerts need a saved place; major global
    /// events (official Red, M6.5+, tsunami, severe cyclone) do not. The site
    /// skips this when its push service is on only so that nothing is said
    /// twice; here the background check and this share one 6-hour memory
    /// (`pnd_notified`), so nothing is said twice either way.
    @MainActor
    func evaluateForeground(model: AppModel) {
        guard !model.fixtureMode else { return }
        let events = model.live, places = model.places
        Task {
            let status = await self.authorizationStatus()
            guard status == .authorized || status == .provisional || status == .ephemeral else { return }
            await Self.post(events: events, places: places)
        }
    }

    // MARK: delegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let path = response.notification.request.content.userInfo["url"] as? String ?? "/personal-risk"
        let url = API.webURL(path: path)
        DispatchQueue.main.async { self.onOpen?(url) }
        completionHandler()
    }
}

/// "Use my location": asks once, with a 10 second timeout. The country is
/// found on the device; the position is never sent anywhere to be named.
@MainActor
final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    enum Failure: Error { case denied, timeout, unavailable }

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D, Error>?
    private var timeout: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    var isAuthorized: Bool {
        let s = manager.authorizationStatus
        return s == .authorizedWhenInUse || s == .authorizedAlways
    }

    func current() async throws -> CLLocationCoordinate2D {
        if ProcessInfo.processInfo.arguments.contains("-PNDFixtureMode") {
            if ProcessInfo.processInfo.arguments.contains("-PNDFixtureLocationDenied") { throw Failure.denied }
            return CLLocationCoordinate2D(latitude: 27.7172, longitude: 85.324)
        }
        let s = manager.authorizationStatus
        if s == .denied || s == .restricted { throw Failure.denied }
        return try await withCheckedThrowingContinuation { c in
            continuation = c
            timeout = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                self?.finish(.failure(Failure.timeout))
            }
            if s == .notDetermined { manager.requestWhenInUseAuthorization() } else { manager.requestLocation() }
        }
    }

    private func finish(_ r: Result<CLLocationCoordinate2D, Error>) {
        timeout?.cancel()
        guard let c = continuation else { return }
        continuation = nil
        c.resume(with: r)
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard self.continuation != nil else { return }
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .denied, .restricted: self.finish(.failure(Failure.denied))
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        let c = l.coordinate
        Task { @MainActor in self.finish(.success(c)) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            let denied = (error as? CLError)?.code == .denied
            self.finish(.failure(denied ? Failure.denied : Failure.unavailable))
        }
    }
}
