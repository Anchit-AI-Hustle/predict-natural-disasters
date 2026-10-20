import Foundation

/// Saved places (`pnd_saved_locations`), kept on the device only.
public final class PlacesStore: @unchecked Sendable {
    public static let key = "pnd_saved_locations"
    let defaults: UserDefaults
    let lock = NSLock()
    public var clock: () -> Double = { Date().timeIntervalSince1970 * 1000 }

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var places: [Place] {
        lock.lock(); defer { lock.unlock() }
        guard let d = defaults.data(forKey: Self.key) else { return [] }
        return (try? JSONDecoder().decode([Place].self, from: d)) ?? []
    }

    func write(_ a: [Place]) {
        lock.lock(); defer { lock.unlock() }
        if let d = try? JSONEncoder().encode(a) { defaults.set(d, forKey: Self.key) }
    }

    /// Saves a place with a new `loc-{epochMs}` id.
    @discardableResult
    public func save(_ p: Place) -> Place {
        var x = p
        x.id = "loc-\(Int64(clock()))"
        x.level = nil; x.full = nil
        var a = places
        while a.contains(where: { $0.id == x.id }) { x.id += "1" }
        a.append(x)
        write(a)
        return x
    }

    public func remove(id: String) { write(places.filter { $0.id != id }) }

    /// Saves or replaces "Current location", rounded to 2 decimals, moved to the front.
    @discardableResult
    public func setCurrent(lat: Double, lon: Double, country: String, now: String) -> Place {
        let p = Place(id: Place.currentID, kind: "Current location", name: "Current location",
                      lat: JS.round(lat * 100) / 100, lon: JS.round(lon * 100) / 100, country: country, countryCode: "", updatedAt: now)
        write([p] + places.filter { $0.id != Place.currentID })
        return p
    }

    public func clearAll() { defaults.removeObject(forKey: Self.key) }

    /// The place Home answers on arrival: the current location, else the first saved.
    public var arrivalPlace: Place? { places.first { $0.id == Place.currentID } ?? places.first }
}

/// What notifications were sent, by key (`pnd_notified`), for 6-hour de-duplication.
public final class NotificationMemory: @unchecked Sendable {
    public static let key = "pnd_notified"
    let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var seen: [String: Double] {
        get { (defaults.dictionary(forKey: Self.key) as? [String: Double]) ?? [:] }
        set {
            // Keep the memory small: anything older than two days can never suppress again.
            let cutoff = (newValue.values.max() ?? 0) - 2 * 86_400_000
            defaults.set(newValue.filter { $0.value >= cutoff }, forKey: Self.key)
        }
    }
}

/// One shared feed: polls every 60 s while a feed screen is visible, asks
/// past the edge copy (`?ts=`) only on an explicit refresh, keeps the last
/// good copy in memory and on disk (api.md section 8).
public actor FeedRepository {
    let client: APIClient
    let cache: FeedCache?
    public private(set) var last: Feed?
    public private(set) var lastError: Error?
    private var inFlight: Task<Feed, Error>?

    public init(client: APIClient = APIClient(), cache: FeedCache? = FeedCache.defaultCache()) {
        self.client = client
        self.cache = cache
    }

    /// The saved copy from disk, labelled as a saved copy.
    public func savedCopy() -> Feed? { cache?.load() }

    public func load(fresh: Bool) async throws -> Feed {
        if let t = inFlight, !fresh { return try await t.value }
        let task = Task<Feed, Error> {
            let (feed, data) = try await self.client.events(fresh: fresh)
            self.cache?.save(data)
            return feed
        }
        inFlight = task
        defer { inFlight = nil }
        do {
            let f = try await task.value
            last = f; lastError = nil
            return f
        } catch {
            lastError = error
            throw error
        }
    }
}
