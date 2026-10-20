// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PNDCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PNDCore", targets: ["PNDCore"])],
    targets: [
        .target(name: "PNDCore"),
        .testTarget(name: "PNDCoreTests", dependencies: ["PNDCore"], resources: [.copy("Fixtures")])
    ]
)
