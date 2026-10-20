import SwiftUI
import MapKit
import UIKit
import PNDCore

enum MapLayer: String, CaseIterable, Identifiable {
    case map = "Map", satellite = "Satellite"
    var id: String { rawValue }
}

/// The site's satellite tiles: Esri World Imagery, then Esri's boundaries and places on top.
enum EsriTiles {
    static let imagery = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    static let reference = "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
    static let attribution = "Tiles \u{00A9} Esri: Esri, HERE, Garmin, \u{00A9} OpenStreetMap contributors"
}

final class RecordAnnotation: NSObject, MKAnnotation {
    let record: Record
    let marker: RiskScale.Marker
    let coordinate: CLLocationCoordinate2D
    var title: String? { Format.titleOf(record) }
    var subtitle: String? { record.type + " \u{00B7} " + record.source }

    init?(_ r: Record) {
        guard let la = r.lat, let lo = r.lon else { return nil }
        record = r
        marker = RiskScale.marker(for: r)
        coordinate = CLLocationCoordinate2D(latitude: la, longitude: lo)
    }
}

final class CentreAnnotation: NSObject, MKAnnotation {
    let coordinate: CLLocationCoordinate2D
    init(_ c: CLLocationCoordinate2D) { coordinate = c }
}

/// Draws a level's marker: the shape filled with the level colour, a white
/// halo and a dark outline, sized 9 + rank*3 (design.md section 3.3).
enum MarkerImage {
    static var cache: [RiskLevel: UIImage] = [:]

    static func image(_ level: RiskLevel) -> UIImage {
        if let i = cache[level] { return i }
        let size = CGFloat(level.markerSize)
        let pad: CGFloat = 3
        let r = UIGraphicsImageRenderer(size: CGSize(width: size + pad * 2, height: size + pad * 2))
        let img = r.image { ctx in
            let rect = CGRect(x: pad, y: pad, width: size, height: size)
            let path = UIBezierPath(cgPath: RiskShape(level: level == .unknown ? .low : level).path(in: rect).cgPath)
            path.usesEvenOddFillRule = level == .watch
            let cg = ctx.cgContext
            cg.setShadow(offset: .zero, blur: 2, color: UIColor.white.withAlphaComponent(0.95).cgColor)
            UIColor(Color(hex: level.colourHex ?? "#8FA8A0")).setFill()
            path.fill()
            cg.setShadow(offset: .zero, blur: 0, color: nil)
            UIColor(Color(hex: "#0B1F19")).setStroke()
            path.lineWidth = 1.5
            path.stroke()
        }
        cache[level] = img
        return img
    }
}

struct RiskMapView: UIViewRepresentable {
    var records: [Record]
    var layer: MapLayer = .map
    var center: CLLocationCoordinate2D? = nil
    var spanDegrees: Double? = nil
    var circleKm: Double? = nil
    var circleColor: UIColor = UIColor(Color(hex: "#25E29C"))
    var circleFill: CGFloat = 0.06
    var showCentreDot = false
    var fitToRecords = false
    var onSelect: ((Record) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let m = MKMapView()
        m.delegate = context.coordinator
        m.overrideUserInterfaceStyle = .dark
        m.pointOfInterestFilter = .excludingAll
        m.register(MKAnnotationView.self, forAnnotationViewWithReuseIdentifier: "risk")
        m.accessibilityIdentifier = "riskMap"
        context.coordinator.applyLayer(m, layer)
        return m
    }

    func updateUIView(_ m: MKMapView, context: Context) {
        let c = context.coordinator
        c.parent = self
        if c.layer != layer { c.applyLayer(m, layer) }
        let ids = records.map { $0.id }
        if ids != c.ids {
            c.ids = ids
            m.removeAnnotations(m.annotations)
            m.addAnnotations(records.compactMap { RecordAnnotation($0) })
            if showCentreDot, let ce = center { m.addAnnotation(CentreAnnotation(ce)) }
        }
        let regionKey = "\(center?.latitude ?? 999),\(center?.longitude ?? 999),\(spanDegrees ?? 0),\(circleKm ?? 0),\(fitToRecords ? ids.count : -1)"
        if regionKey != c.regionKey {
            c.regionKey = regionKey
            m.removeOverlays(m.overlays.filter { $0 is MKCircle })
            if let ce = center, let km = circleKm { m.addOverlay(MKCircle(center: ce, radius: km * 1000), level: .aboveLabels) }
            if let ce = center {
                let span = spanDegrees ?? 8
                m.setRegion(MKCoordinateRegion(center: ce, span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)), animated: false)
            } else if fitToRecords, !m.annotations.isEmpty {
                m.showAnnotations(m.annotations, animated: false)
            } else {
                m.setRegion(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 20, longitude: 20), span: MKCoordinateSpan(latitudeDelta: 140, longitudeDelta: 300)), animated: false)
            }
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: RiskMapView
        var ids: [String] = []
        var regionKey = ""
        var layer: MapLayer?
        init(_ p: RiskMapView) { parent = p }

        func applyLayer(_ m: MKMapView, _ l: MapLayer) {
            layer = l
            m.removeOverlays(m.overlays.filter { $0 is MKTileOverlay })
            switch l {
            case .map:
                // The clear default, so markers stay readable.
                m.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
            case .satellite:
                let base = MKTileOverlay(urlTemplate: EsriTiles.imagery)
                base.canReplaceMapContent = true
                base.maximumZ = 19
                let ref = MKTileOverlay(urlTemplate: EsriTiles.reference)
                ref.maximumZ = 19
                m.addOverlay(base, level: .aboveRoads)
                m.addOverlay(ref, level: .aboveRoads)
            }
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let t = overlay as? MKTileOverlay { return MKTileOverlayRenderer(tileOverlay: t) }
            if let c = overlay as? MKCircle {
                let r = MKCircleRenderer(circle: c)
                r.strokeColor = parent.circleColor
                r.lineWidth = 1
                r.fillColor = parent.circleColor.withAlphaComponent(parent.circleFill)
                return r
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let a = annotation as? RecordAnnotation {
                let v = mapView.dequeueReusableAnnotationView(withIdentifier: "risk", for: a)
                v.image = MarkerImage.image(a.marker.level)
                v.zPriority = MKAnnotationViewZPriority(rawValue: Float(a.marker.level.rank * 150))
                v.displayPriority = .required
                v.canShowCallout = true
                let b = UIButton(type: .detailDisclosure)
                b.accessibilityLabel = "See details"
                v.rightCalloutAccessoryView = b
                v.isAccessibilityElement = true
                v.accessibilityLabel = a.marker.label
                return v
            }
            if annotation is CentreAnnotation {
                let v = MKAnnotationView(annotation: annotation, reuseIdentifier: nil)
                let r = UIGraphicsImageRenderer(size: CGSize(width: 14, height: 14))
                v.image = r.image { _ in
                    let p = UIBezierPath(ovalIn: CGRect(x: 2, y: 2, width: 10, height: 10))
                    UIColor(Color(hex: "#25E29C")).setFill(); p.fill()
                    UIColor.white.setStroke(); p.lineWidth = 2; p.stroke()
                }
                v.accessibilityLabel = "Centre of the place"
                return v
            }
            return nil
        }

        func mapView(_ mapView: MKMapView, annotationView view: MKAnnotationView, calloutAccessoryControlTapped control: UIControl) {
            if let a = view.annotation as? RecordAnnotation { parent.onSelect?(a.record) }
        }
    }
}

/// A map with the layer switch, the key and the Esri credit.
struct MapCard: View {
    let records: [Record]
    var height: CGFloat
    var center: CLLocationCoordinate2D?
    var spanDegrees: Double?
    var circleKm: Double?
    var circleColor: Color
    var circleFill: CGFloat
    var showCentreDot: Bool
    var fitToRecords: Bool
    var onSelect: ((Record) -> Void)?
    @AppStorage("pnd_map_layer") var layerRaw = MapLayer.map.rawValue
    @State var showKey = false

    init(records: [Record], height: CGFloat = 300, center: CLLocationCoordinate2D? = nil, spanDegrees: Double? = nil,
         circleKm: Double? = nil, circleColor: Color = Theme.green, circleFill: CGFloat = 0.06, showCentreDot: Bool = false,
         fitToRecords: Bool = false, onSelect: ((Record) -> Void)? = nil) {
        self.records = records; self.height = height; self.center = center; self.spanDegrees = spanDegrees
        self.circleKm = circleKm; self.circleColor = circleColor; self.circleFill = circleFill
        self.showCentreDot = showCentreDot; self.fitToRecords = fitToRecords; self.onSelect = onSelect
    }

    var body: some View {
        let layer = MapLayer(rawValue: layerRaw) ?? .map
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Picker("Map layer", selection: $layerRaw) {
                    ForEach(MapLayer.allCases) { Text($0.rawValue).tag($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 220)
                Spacer()
                Button(showKey ? "Hide key" : "Key") { showKey.toggle() }
                    .buttonStyle(OutlinePillButtonStyle())
                    .accessibilityLabel("Map key")
            }
            RiskMapView(records: records, layer: layer, center: center, spanDegrees: spanDegrees, circleKm: circleKm,
                        circleColor: UIColor(circleColor), circleFill: circleFill, showCentreDot: showCentreDot,
                        fitToRecords: fitToRecords, onSelect: onSelect)
                .frame(height: height)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
                .accessibilityLabel("Map of \(records.count) reports")
            if showKey { MapKey(records: records) }
            if layer == .satellite {
                Text(EsriTiles.attribution).font(.caption2).foregroundStyle(Theme.muted)
            }
        }
    }
}

/// The map key: each level with its mark and how many are drawn.
struct MapKey: View {
    let records: [Record]
    var body: some View {
        let levels = RiskLevel.filterOptions
        VStack(alignment: .leading, spacing: 4) {
            ForEach(levels, id: \.self) { l in
                let n = records.filter { RiskScale.marker(for: $0).level == l }.count
                HStack(spacing: 8) {
                    RiskGlyph(level: l, color: l.fill ?? Color(hex: "#8FA8A0")).frame(width: 12, height: 12)
                    Text(l.label).font(.footnote).foregroundStyle(Theme.text)
                    Spacer()
                    Text("\(n)").font(.footnote.monospacedDigit()).foregroundStyle(Theme.muted)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(10)
        .background(Color(hex: "#04120E").opacity(0.92), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: "#1F4A3C"), lineWidth: 1))
        .accessibilityIdentifier("mapKey")
    }
}
