import SwiftUI
import PNDCore

/// The trust note shown on every screen with a forecast or a risk level
/// (features.md section 15.1). Its times come from the data, in the chosen zone.
struct TrustNote: View {
    @EnvironmentObject var model: AppModel
    var groups: [Trust.Group] = [.feed, .models]
    var ledgerTimes: [String]? = nil
    var ledgerFailed = false
    @State var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                ZStack {
                    Circle().stroke(Theme.amber, lineWidth: 1.5).frame(width: 18, height: 18)
                    Text("i").font(.system(size: 12, design: .serif).italic()).foregroundStyle(Theme.amber)
                }
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(Trust.headline).font(.subheadline.bold()).foregroundStyle(Color(hex: "#D9EBE3"))
                    Text(Trust.lead).font(.subheadline).foregroundStyle(Color(hex: "#D9EBE3"))
                    AgencyLinks()
                }
            }
            Text(Trust.updatedLine(groups: groups, feed: model.trustFeedState, ledgerTimes: ledgerTimes, ledgerFailed: ledgerFailed, tz: model.zoneID))
                .font(.footnote).foregroundStyle(Theme.trustWhen)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("trustWhen")
            DisclosureGroup(isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(Trust.list(groups).enumerated()), id: \.offset) { _, s in
                        let st = Trust.status(s, meta: model.meta, tz: model.zoneID)
                        VStack(alignment: .leading, spacing: 2) {
                            if let u = URL(string: s.url, relativeTo: API.baseURL) {
                                Link(s.name, destination: u.absoluteURL).font(.footnote.weight(.semibold)).foregroundStyle(Theme.link)
                            }
                            if !st.text.isEmpty {
                                Text(st.text).font(.caption)
                                    .foregroundStyle(st.state == .answered ? Theme.green : (st.state == .notAnswering ? Theme.amber : Theme.trustWhen))
                            }
                            Text(s.adds).font(.caption).foregroundStyle(Color(hex: "#C4D8CF")).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Text("What each source can and cannot see: Our sources \u{00B7} How it works").font(.caption).foregroundStyle(Theme.trustWhen)
                }
                .padding(.top, 6)
            } label: {
                Text(Trust.summary(groups)).font(.footnote).foregroundStyle(Theme.greenText).multilineTextAlignment(.leading)
            }
            .tint(Theme.greenText)
        }
        .padding(.vertical, 9).padding(.horizontal, 12)
        .background(Theme.trustFill, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.provBorder, lineWidth: 1))
        .overlay(alignment: .leading) { Rectangle().fill(Theme.amber).frame(width: 3).clipShape(RoundedRectangle(cornerRadius: 1.5)) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("trustNote")
    }
}

/// "IMD and NDMA in India, NWS and USGS in the US, GDACS worldwide." as links.
struct AgencyLinks: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Trust.official, id: \.region) { r in
                HStack(spacing: 6) {
                    ForEach(r.agencies, id: \.name) { a in
                        Link(a.name, destination: URL(string: a.url)!)
                            .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.link)
                            .frame(minHeight: 32)
                            .accessibilityLabel(a.full)
                    }
                    Text(r.phrase).font(.subheadline).foregroundStyle(Color(hex: "#D9EBE3"))
                }
            }
        }
    }
}

/// The footer agencies, on the More screen and at the bottom of long screens
/// (features.md section 15.2).
struct FooterAgencies: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Trust.footerHeadline).font(.footnote.bold()).foregroundStyle(Color(hex: "#E6F2EC"))
            Text(Trust.footerLead).font(.footnote).foregroundStyle(Theme.trustWhen)
            ForEach(Trust.official, id: \.region) { r in
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.region + ":").font(.footnote.weight(.semibold)).foregroundStyle(Color(hex: "#E6F2EC"))
                    ForEach(r.agencies, id: \.name) { a in
                        Link(destination: URL(string: a.url)!) {
                            Text(a.full + " (" + a.name + ")").font(.footnote).foregroundStyle(Theme.greenText)
                            + Text("  " + a.domain).font(.caption).foregroundStyle(Theme.trustWhen)
                        }
                        .frame(minHeight: 32, alignment: .leading)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Elsewhere:").font(.footnote.weight(.semibold)).foregroundStyle(Color(hex: "#E6F2EC"))
                Link(Trust.wmo.name, destination: URL(string: Trust.wmo.url)!)
                    .font(.footnote).foregroundStyle(Theme.greenText)
                    .frame(minHeight: 32, alignment: .leading)
                    .accessibilityLabel(Trust.wmo.full)
            }
            Text(Copy.footerLine).font(.caption).foregroundStyle(Theme.trustWhen)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: "#03140F"))
        .overlay(alignment: .top) { Rectangle().fill(Color(hex: "#174638")).frame(height: 1) }
        .accessibilityIdentifier("footerAgencies")
    }
}

/// The banner shown when the feed failed, with the site's wording, and the
/// saved-copy label with its own time.
struct FeedBanner: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if model.status == .failed {
                Notice(text: Copy.loadError, stale: true).accessibilityIdentifier("feedError")
            }
            if let f = model.feed, f.isSavedCopy {
                Notice(text: "Showing a saved copy of the feed from " + Format.fmtDate(f.generatedAt, tz: model.zoneID) +
                       ". It may be out of date.", stale: true)
                    .accessibilityIdentifier("savedCopy")
            }
        }
    }
}
