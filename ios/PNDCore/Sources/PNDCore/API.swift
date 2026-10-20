import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The feed as one response (`{generatedAt, meta, events}`, api.md section 1.3).
public struct Feed: Sendable {
    public let generatedAt: String?
    public let meta: JSONValue?
    /// Every record, including quiet ones (`all: true`).
    public let all: [Record]
    /// Saved copy read from disk rather than fetched now (labelled in the UI).
    public var isSavedCopy: Bool = false
    /// When this copy was saved to disk (device time, only for the label).
    public var savedAt: Date? = nil

    public init(generatedAt: String?, meta: JSONValue?, all: [Record]) {
        self.generatedAt = generatedAt; self.meta = meta; self.all = all
    }

    public init(json: JSONValue) {
        let ev = json["events"]?.arrayValue ?? []
        self.init(generatedAt: json["generatedAt"]?.stringValue, meta: json["meta"], all: ev.compactMap { Record(json: $0) })
    }

    /// Lists show live records only (`live !== false`).
    public var live: [Record] { all.filter { $0.isLive } }
    public var notLive: [Record] { all.filter { !$0.isLive } }
    public var metaLive: Bool { meta?["live"]?.isTruthy ?? false }
}

/// The site's HTTP contract (api.md).
public enum API {
    public static let baseURL = URL(string: "https://predict-natural-disasters.anchit-tandon.com")!
    public static let siteHost = "predict-natural-disasters.anchit-tandon.com"
    public static var userAgent = "PredictNaturalDisasters-iOS/\(PNDCore.version) (+https://predict-natural-disasters.anchit-tandon.com/about)"

    public static func eventsURL(fresh: Bool, now: Double = Format.now()) -> URL {
        fresh ? URL(string: "/api/events?ts=\(Int64(now))", relativeTo: baseURL)!.absoluteURL
              : URL(string: "/api/events", relativeTo: baseURL)!.absoluteURL
    }

    public static var summaryURL: URL { URL(string: "/api/events?summary=1", relativeTo: baseURL)!.absoluteURL }
    public static var ledgerURL: URL { URL(string: "/api/events?ledger=1", relativeTo: baseURL)!.absoluteURL }
    public static var alertsURL: URL { URL(string: "/api/alerts", relativeTo: baseURL)!.absoluteURL }

    public static func dataURL(_ file: String, now: Double = Format.now()) -> URL {
        URL(string: "/data/\(file)?ts=\(Int64(now))", relativeTo: baseURL)!.absoluteURL
    }

    /// Query component encoding that matches `encodeURIComponent`.
    static func q(_ s: String) -> String { JS.encodeURIComponent(s) }

    /// `URLSearchParams` (form) encoding: space is "+", and only
    /// alphanumerics and `*-._` stay as they are.
    public static func formEncode(_ s: String) -> String {
        var out = ""
        for b in s.utf8 {
            switch b {
            case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2A, 0x2D, 0x2E, 0x5F: out.append(Character(UnicodeScalar(b)))
            case 0x20: out.append("+")
            default: out += String(format: "%%%02X", b)
            }
        }
        return out
    }

    /// The enrichment request, with the parameters in the website's order so
    /// the CDN cache is shared (api.md section 3.1).
    public static func enrichmentURL(title: String, country: String, region: String, type: String, updated: String,
                                     forecast: Bool, lat: Double?, lon: Double?) -> URL {
        let f = formEncode
        var parts = ["title=" + f(title), "country=" + f(country), "region=" + f(region), "type=" + f(type),
                     "updated=" + f(updated), "forecast=" + (forecast ? "true" : "false")]
        if let la = lat, let lo = lon, la.isFinite, lo.isFinite {
            parts.append("lat=" + JS.numberString(la)); parts.append("lon=" + JS.numberString(lo))
        }
        return URL(string: "/api/event-enrichment?" + parts.joined(separator: "&"), relativeTo: baseURL)!.absoluteURL
    }

    public static func enrichmentURL(for e: Record) -> URL {
        enrichmentURL(title: e.title, country: e.country, region: e.region, type: e.type, updated: e.updated,
                      forecast: e.forecast, lat: e.lat, lon: e.lon)
    }

    public static func nominatimURL(_ q: String, limit: Int = 8) -> URL {
        URL(string: "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=en&limit=\(limit)&q=" + API.q(q))!
    }

    public static func webURL(path: String) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL
    }
}

public enum APIError: Error, Equatable {
    case http(Int)
    case decoding
    case offline
}

/// Network transport, injectable for tests.
public protocol HTTPTransport: Sendable {
    func get(_ url: URL, headers: [String: String], timeout: TimeInterval) async throws -> (Data, Int)
}

public struct URLSessionTransport: HTTPTransport {
    let session: URLSession
    public init(session: URLSession = .shared) { self.session = session }

    public func get(_ url: URL, headers: [String: String], timeout: TimeInterval) async throws -> (Data, Int) {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        return try await withCheckedThrowingContinuation { cont in
            let task = session.dataTask(with: req) { data, resp, err in
                if let err = err { cont.resume(throwing: err); return }
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                cont.resume(returning: (data ?? Data(), code))
            }
            task.resume()
        }
    }
}

/// The API client. No HTTP cache: the feed is `no-store` (api.md section 1.2).
public final class APIClient: @unchecked Sendable {
    public let transport: HTTPTransport
    public init(transport: HTTPTransport = URLSessionTransport()) { self.transport = transport }

    var headers: [String: String] { ["Accept": "application/json", "User-Agent": API.userAgent] }

    public func getJSON(_ url: URL, timeout: TimeInterval = 25) async throws -> JSONValue {
        let (data, code) = try await transport.get(url, headers: headers, timeout: timeout)
        guard code == 200 else { throw APIError.http(code) }
        do { return try JSONValue.parse(data) } catch { throw APIError.decoding }
    }

    /// `GET /api/events`; `fresh` adds `?ts=` (only for an explicit refresh).
    public func events(fresh: Bool) async throws -> (Feed, Data) {
        let (data, code) = try await transport.get(API.eventsURL(fresh: fresh), headers: headers, timeout: 25)
        guard code == 200 else { throw APIError.http(code) }
        guard let json = try? JSONValue.parse(data), json["events"] != nil || json["meta"] != nil else { throw APIError.decoding }
        return (Feed(json: json), data)
    }

    public func summary() async throws -> JSONValue { try await getJSON(API.summaryURL) }

    /// The last ledger row with this id, from the static ledger (api.md section 2 and 5).
    public func ledgerRow(id: String) async throws -> Record? {
        let json = try await getJSON(API.dataURL("outlook-ledger.json"), timeout: 60)
        let rows = (json.arrayValue ?? json["ledger"]?.arrayValue ?? []).compactMap { Record(json: $0) }
        return rows.last { $0.id == id }
    }

    public func enrichment(_ url: URL) async throws -> Enrichment {
        Enrichment(json: try await getJSON(url))
    }

    public func alertsInfo() async throws -> JSONValue { try await getJSON(API.alertsURL) }

    public func dataFile(_ name: String) async throws -> JSONValue { try await getJSON(API.dataURL(name), timeout: 60) }

    /// Nominatim search; runs only on an explicit submit (usage policy).
    public func searchPlaces(_ q: String) async throws -> [Place] {
        let (data, code) = try await transport.get(API.nominatimURL(q), headers: headers, timeout: 20)
        guard code == 200 else { throw APIError.http(code) }
        return PlaceSearch.candidates(try JSONValue.parse(data))
    }
}

/// The last good feed on disk, labelled as a saved copy with its own time.
public struct FeedCache: Sendable {
    public let url: URL
    public init(directory: URL) { url = directory.appendingPathComponent("last-feed.json") }

    public static func defaultCache() -> FeedCache {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        return FeedCache(directory: dir)
    }

    public func save(_ data: Data) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    public func load() -> Feed? {
        guard let data = try? Data(contentsOf: url), let json = try? JSONValue.parse(data) else { return nil }
        var f = Feed(json: json)
        f.isSavedCopy = true
        f.savedAt = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
        return f
    }

    public func clear() { try? FileManager.default.removeItem(at: url) }
}
