import SwiftUI
import PNDCore

/// My places (features.md section 5).
struct MyPlacesView: View {
    @EnvironmentObject var model: AppModel
    @StateObject var location = LocationService()
    @State var kind = "Home"
    @State var name = ""
    @State var latText = ""
    @State var lonText = ""
    @State var chosen: Place?
    /// What the search filled in (`chosenAs = name|lat|lon`, changelog C23).
    @State var chosenAs = ""
    @State var candidates: [Place] = []
    @State var formNote: String?
    @State var alertNote: String?
    @State var permission: String = ""
    @State var sort = SortPicker.initial("personal-risk_sortBy", Sorts.myPlacesSorts)
    @State var showKeeps = false

    var body: some View {
        ScreenScroll(title: "My places") {
            ScreenHeader(title: "My places", subtitle: "Your saved places, and the dangers reported near them.")
            TrustNote(groups: [.feed, .models, .place])
            FeedBanner()
            alertsPanel
            savedPanel
            dangers
        }
        .task { await refreshPermission() }
    }

    // MARK: alerts (5.1)

    var alertsPanel: some View {
        let rules = model.alertsInfo?["rules"]
        let near = rules?["nearKm"]?.jsString ?? JS.numberString(AlertRules.nearKm)
        let severe = rules?["severeNearKm"]?.jsString ?? JS.numberString(AlertRules.severeNearKm)
        return Panel("Alerts") {
            Text(statusText).font(.subheadline).foregroundStyle(Theme.textSoft).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("alertsStatus")
            Text(Copy.notificationsHonesty).font(.footnote).foregroundStyle(Theme.noticeText)
            FlowRow(spacing: 8) {
                if permission != "blocked" {
                    Button(model.alertsEnabled ? "Turn off alerts" : "Turn on alerts") { toggleAlerts() }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("alertsToggle")
                }
                Button("Use my current location") { useCurrent() }.buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("useCurrentLocation")
            }
            if let n = alertNote { Text(n).font(.footnote).foregroundStyle(Theme.greenText).accessibilityIdentifier("alertNote") }
            DisclosureGroup("What we send and what we keep", isExpanded: $showKeeps) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.alertsInfo?["keeps"]?.stringValue ?? "This app keeps your places on this device only. Nothing about them is sent to us.")
                        .font(.footnote).foregroundStyle(Theme.textSoft)
                    Text("This app keeps your saved places on this device. Alerts are checked on this device, so no place is sent anywhere.")
                        .font(.footnote).foregroundStyle(Theme.textSoft)
                }
            }
            .tint(Theme.greenText).foregroundStyle(Theme.greenText)
            Text("You get an alert when a saved place is inside an official warning area or a reported affected area, or when a danger is reported within \(near) km of it (\(severe) km if it is severe). We never send alerts for our own forecasts.")
                .font(.footnote).foregroundStyle(Theme.muted)
        }
    }

    var statusText: String {
        let n = model.places.count
        switch permission {
        case "blocked": return "Notifications are blocked for this app in iOS Settings, so no alert can be shown. You can still see the dangers near your places below."
        default:
            if model.alertsEnabled {
                var t = "Alerts are on for \(n) place" + (n == 1 ? "" : "s") + " on this device. They are checked when the app updates, and in the background when iOS allows."
                if let last = UserDefaults.standard.string(forKey: "pnd_alerts_last_check") { t += " Last background check " + Format.age(last) + "." }
                return t
            }
            return "Alerts are off. Turn them on to be told when something is reported at or near your saved places."
        }
    }

    func refreshPermission() async {
        let s = await NotificationService.shared.authorizationStatus()
        permission = s == .denied ? "blocked" : (s == .authorized || s == .provisional ? "granted" : "unknown")
    }

    func toggleAlerts() {
        if model.alertsEnabled {
            model.alertsEnabled = false
            model.reloadPlaces()
            alertNote = "Alerts are off. Nothing will be sent."
            return
        }
        Task {
            let ok = await NotificationService.shared.requestPermission()
            await refreshPermission()
            if ok {
                model.alertsEnabled = true
                model.reloadPlaces()
                alertNote = "Alerts are on for this device."
            } else {
                alertNote = "Notifications were not allowed, so nothing will be sent."
            }
        }
    }

    func useCurrent() {
        Task {
            do {
                let c = try await location.current()
                let p = model.setCurrentLocation(lat: c.latitude, lon: c.longitude)
                alertNote = "Saved as \u{201C}Current location\u{201D}, to the nearest kilometre (" + (p.country.isEmpty ? "country unknown" : p.country) + "). It is updated each time you open this app."
            } catch {
                alertNote = "Location was not shared, so nothing was checked."
            }
        }
    }

    // MARK: saved places (5.2)

    var savedPanel: some View {
        Panel("Saved places") {
            Picker("Kind", selection: $kind) { ForEach(Place.kinds, id: \.self) { Text($0).tag($0) } }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("kindPicker")
            HStack {
                SearchField(prompt: "Place name", text: $name, onSubmit: find).accessibilityIdentifier("placeName")
                Button("Find place", action: find).buttonStyle(SecondaryButtonStyle()).accessibilityIdentifier("findPlace")
            }
            .onChange(of: name) { _, _ in edited() }
            HStack {
                TextField("Latitude", text: $latText).keyboardType(.numbersAndPunctuation).fieldStyle().accessibilityLabel("Latitude")
                TextField("Longitude", text: $lonText).keyboardType(.numbersAndPunctuation).fieldStyle().accessibilityLabel("Longitude")
                Button("Save", action: save).buttonStyle(PrimaryButtonStyle()).accessibilityIdentifier("savePlaceForm")
            }
            .onChange(of: latText) { _, _ in edited() }
            .onChange(of: lonText) { _, _ in edited() }
            Text("Search for the place by name, then choose the right match. You can also type the latitude and longitude yourself.")
                .font(.footnote).foregroundStyle(Theme.muted)
            if let n = formNote { Text(n).font(.footnote).foregroundStyle(Theme.greenText).accessibilityIdentifier("formNote") }
            if !candidates.isEmpty { PlaceChooser(candidates: candidates) { choose($0) } }
            if model.places.isEmpty {
                Text("No saved places yet. Search for a place above and save it.").font(.subheadline).foregroundStyle(Theme.muted)
                    .accessibilityIdentifier("noSavedPlaces")
            }
            ForEach(model.places) { p in savedCard(p) }
        }
    }

    func savedCard(_ p: Place) -> some View {
        let a = PlaceRisk.assess(p, model.live, generatedAt: model.feed?.generatedAt)
        let coords = (p.lat.map { JS.numberString($0) } ?? "-") + ", " + (p.lon.map { JS.numberString($0) } ?? "-")
        return CardBox {
            Text(p.displayName).font(.headline).foregroundStyle(Theme.text)
            Text(placeLine(p, coords: coords))
                .font(.footnote).foregroundStyle(Theme.muted)
            HStack {
                if a.level == nil { NothingNearbyChip() } else { RiskBadge(level: a.level!, text: a.headline) }
                Text(PlaceRisk.summaryChip(a)).font(.caption.weight(.heavy)).foregroundStyle(Theme.textSoft)
            }
            .accessibilityElement(children: .combine)
            Button("Remove") { model.removePlace(p.id) }.buttonStyle(SecondaryButtonStyle())
                .accessibilityLabel("Remove " + p.displayName)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("savedPlace")
    }

    func placeLine(_ p: Place, coords: String) -> String {
        var t: String = coords
        t += p.country.isEmpty ? " \u{00B7} country unknown" : " \u{00B7} " + p.country
        if let u = p.updatedAt { t += " \u{00B7} updated " + Format.age(u) }
        return t
    }

    func scopeNote(noCountry: Int, countryWide: Int) -> String {
        let has: String = noCountry == 1 ? "has" : "have"
        let fs: String = countryWide == 1 ? "" : "s"
        let apply: String = countryWide == 1 ? "applies" : "apply"
        let them: String = noCountry == 1 ? "it" : "them"
        return "\(noCountry) of your saved places \(has) no country recorded, so we cannot tell whether \(countryWide) forecast\(fs) that cover a whole country \(apply) to \(them). Search for the place by name instead of typing coordinates, and we can check."
    }

    func rowLine(_ r: DangerRow) -> String {
        let where_: String = r.row.claimDistance ? JS.numberString(JS.round(r.d)) + " km from " + r.place.name : r.place.name
        return where_ + " \u{00B7} " + r.record.type
    }

    func find() {
        let q = name.trimmingCharacters(in: .whitespacesAndNewlines)
        candidates = []
        guard !q.isEmpty else { formNote = "Type a place first."; return }
        formNote = PlaceSearch.finding
        Task {
            do {
                let found = try await model.client.searchPlaces(q)
                if found.isEmpty { formNote = PlaceSearch.notFound }
                else if found.count == 1 { choose(found[0]) }
                else { formNote = PlaceSearch.foundMany(found.count); candidates = found }
            } catch {
                formNote = PlaceSearch.failedPlaces
            }
        }
    }

    func choose(_ c: Place) {
        candidates = []
        chosen = c
        name = c.name
        latText = JS.toFixed(c.lat ?? 0, 6)
        lonText = JS.toFixed(c.lon ?? 0, 6)
        chosenAs = PlaceSearch.chosenAs(name: c.name, lat: JS.toFixed(c.lat ?? 0, 6), lon: JS.toFixed(c.lon ?? 0, 6))
        formNote = "Chosen: \(c.name) (\((c.level ?? "place").lowercased())). Choose the kind of place and press Save."
    }

    /// An edit by the reader forgets the country the search found. A change
    /// whose values still equal what the search filled in (the one that
    /// follows pressing Enter) keeps it (changelog C23).
    func edited() {
        guard let c = chosen else { return }
        let now = PlaceSearch.chosenAs(name: name, lat: latText, lon: lonText)
        if PlaceSearch.editForgetsCountry(chosenAs: chosenAs, now: now, hasCountry: !c.country.isEmpty || !c.countryCode.isEmpty) {
            chosen = nil
            chosenAs = ""
            formNote = PlaceSearch.countryForgotten
        }
    }

    func save() {
        let lat = Double(latText.trimmingCharacters(in: .whitespaces)), lon = Double(lonText.trimmingCharacters(in: .whitespaces))
        guard let la = lat, let lo = lon, (-90...90).contains(la), (-180...180).contains(lo) else {
            formNote = "Enter a latitude from -90 to 90 and a longitude from -180 to 180, or search for the place by name."
            return
        }
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        model.savePlace(Place(kind: kind, name: n.isEmpty ? kind : n, lat: la, lon: lo, country: chosen?.country ?? "", countryCode: chosen?.countryCode ?? ""))
        formNote = "Saved."
        name = ""; latText = ""; lonText = ""; chosen = nil; chosenAs = ""
    }

    // MARK: dangers near your places (5.3)

    struct DangerRow: Identifiable {
        let id: String
        let record: Record
        let place: Place
        let row: PlaceRisk.Row
        var d: Double { row.distanceKm ?? .infinity }
    }

    var rows: [DangerRow] {
        var out: [DangerRow] = []
        for p in model.places {
            for e in model.live {
                if let r = PlaceRisk.riskRow(e, p) { out.append(DangerRow(id: p.id + "|" + e.id, record: e, place: p, row: r)) }
            }
        }
        let bandOrder: (DangerRow) -> Int = { ["A": 0, "B": 1, "C": 2, "D": 3, "E": 4][$0.row.band.rawValue] ?? 9 }
        if sort == "nearby" {
            return Sorts.stableSort(out) { a, b in
                let x = Double(bandOrder(a) - bandOrder(b))
                return x != 0 ? x : Sorts.sub(a.d, b.d)
            }
        }
        return Sorts.stableSort(out) { a, b in
            let c = Sorts.compare(sort, a.record, b.record)
            return c != 0 ? c : Sorts.sub(a.d, b.d)
        }
    }

    var dangers: some View {
        let all = rows
        let countryWide = model.live.filter { $0.forecast && $0.s("forecastScope") == "country" }.count
        let noCountry = model.places.filter { $0.country.isEmpty && $0.countryCode.isEmpty }.count
        return Panel("Dangers near your places") {
            Text("Grouped by how sure we can be that each one affects your place. We show a distance only when the report gives the exact spot.")
                .font(.footnote).foregroundStyle(Theme.muted)
            HStack {
                Text("Updated " + Format.age(model.feed?.generatedAt)).font(.footnote).foregroundStyle(Theme.muted)
                Spacer()
                SortPicker(screen: "personal-risk_sortBy", keys: Sorts.myPlacesSorts, selection: $sort)
            }
            if model.status == .failed {
                Notice(text: "We could not load the latest data. Do not rely on this page in an emergency. Check with your local authorities.", stale: true)
            }
            if countryWide > 0 && noCountry > 0 {
                Notice(text: scopeNote(noCountry: noCountry, countryWide: countryWide))
            }
            ForEach(PlaceRisk.bands, id: \.band) { b in
                let inBand = all.filter { $0.row.band == b.band }
                VStack(alignment: .leading, spacing: 6) {
                    Text(b.title).font(.subheadline.bold()).foregroundStyle(Theme.text).accessibilityAddTraits(.isHeader)
                    Text(b.blurb).font(.caption).foregroundStyle(Theme.muted)
                    if inBand.isEmpty {
                        Text(b.empty).font(.footnote).foregroundStyle(Theme.muted)
                    }
                    ForEach(inBand.prefix(30)) { r in
                        RouteLink(value: Route.detail(for: r.record)) {
                            CardBox {
                                Pill(text: Format.provenance(r.record))
                                Text(r.record.title).font(.subheadline.bold()).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                                Text(rowLine(r))
                                    .font(.footnote).foregroundStyle(Theme.muted)
                                if !r.row.applicability.isEmpty { Text(r.row.applicability).font(.caption).foregroundStyle(Theme.muted) }
                            }
                        }
                        .buttonStyle(.plainArea)
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("band-" + b.band.rawValue)
            }
        }
    }
}
