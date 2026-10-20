import XCTest
@testable import PNDCore
final class SmokeTests: XCTestCase { func testVersion() { XCTAssertEqual(PNDCore.version, "1.0.0") } }
