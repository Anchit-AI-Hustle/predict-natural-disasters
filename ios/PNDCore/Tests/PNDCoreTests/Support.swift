import Foundation
import XCTest
@testable import PNDCore

enum Fixtures {
    static func url(_ name: String) -> URL {
        if let u = Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures") { return u }
        if let u = Bundle.module.url(forResource: name, withExtension: nil) { return u }
        // Fallback: the source tree.
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures").appendingPathComponent(name)
    }

    static func json(_ name: String) -> JSONValue {
        let data = try! Data(contentsOf: url(name))
        return try! JSONValue.parse(data)
    }

    static let vectors: JSONValue = json("test-vectors.json")

    /// The fixed "now" the vectors were generated at.
    static var now: Double { JSDate.ms(vectors["meta"]?["now"]?.stringValue)! }

    static func group(_ key: String) -> [JSONValue] { vectors[key]?.arrayValue ?? [] }

    static func event(_ name: String) -> Record { Record(json: vectors["fixtures.events"]![name]!)! }
    static func place(_ name: String) -> Place { Place(json: vectors["fixtures.places"]![name]!) }

    /// The repository root (two levels above ios/PNDCore).
    static var repoRoot: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }
}

func rec(_ v: JSONValue?) -> Record { Record(json: v ?? .object([:])) ?? Record([:]) }

/// Runs `body` with the display zone and clock set as the vectors expect.
func withZone<T>(_ tz: String?, _ body: () -> T) -> T {
    let oldZ = Format.zoneID, oldNow = Format.now
    Format.zoneID = tz ?? "Asia/Kolkata"
    let n = Fixtures.now
    Format.now = { n }
    defer { Format.zoneID = oldZ; Format.now = oldNow }
    return body()
}
