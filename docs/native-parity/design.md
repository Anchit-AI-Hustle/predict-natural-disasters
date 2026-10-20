# Design spec (dark theme only)

The tokens and components below come from `portal.css`, `risk.css`, `app-pages.css`, the inline styles in
`index.html` and `accuracy.html`, the CSS injected by `trust.js`, and the map CSS in `map-setup.js`. The website has
**no light theme**, so the native apps should force dark appearance (iOS `.preferredColorScheme(.dark)`; Compose
`darkColorScheme` only). Browser `theme-color` is `#02110d`, and the manifest uses `theme_color #0b2a20` with
`background_color #02110d`.

Units: CSS px map 1:1 to iOS pt and Android dp. Web text is dense, with many labels at 9 to 11 px. **Native should
use the minimum sizes in the "native" column and scale with Dynamic Type or font scale.** Keep the hierarchy
(label < body < title), not the absolute web sizes.

---

## 1. Colour tokens

### 1.1 Base surfaces and text (`:root` in `portal.css` and `app-pages.css`)

| token | hex | use |
| --- | --- | --- |
| `bg` | `#02110D` | app background. The web paints a radial gradient `radial-gradient(circle at 32% -10%, #0B3C2D 0, #04130F 33%, #02100D 100%)` behind the page; native can use a top-left glow over `#02110D` |
| `panel` | `#06261D` | panel surface (base) |
| `panelGradTop` / `panelGradBottom` | `#07251B` → `#051B14` | `.panel` vertical gradient |
| `panel2` | `#082E23` | raised panel |
| `card` | `#09231B` | `.card`, `.event-card`, inputs (`#09251D`) |
| `cardAlt` | `#08251C` | key fact tiles, hazard definition box, observed rows, `.item` |
| `line` | `#156047` | primary border |
| `line2` | `#0D4535` | header and hero bottom border |
| `panelBorder` | `#1D654C` | `.panel` border, place result border |
| `cardBorder` | `#285C49` | `.card` and `.event-card` border |
| `inputBorder` | `#285F4B` | inputs, selects, buttons |
| `divider` | `#153F33` / `#1B5745` | table rows / panel header underline |
| `text` | `#F5FBF8` | primary text |
| `textSoft` | `#CBE0D7` / `#CFE3DA` / `#DCECE4` | hero subtitles, body in cards |
| `muted` | `#91B4A6` | secondary text, labels |
| `label` | `#8EAA9E` / `#8FB0A2` | uppercase table headers and key-fact labels |
| `ink` | `#10130F` | dark text on light chips |
| `green` (accent) | `#25E29C` | brand accent, active tab, primary button fill, focus |
| `greenText` | `#8FF0CA` | active tab text, accent links in the footer |
| `greenLive` | `#65E7B6` / `#62E8B5` | "● Live" chip text |
| `link` | `#6FE3FF` | inline links (clears 7:1 on every surface) |
| `linkVisited` | `#D7B8FF` | |
| `linkHover` | `#B7F5FF` | pressed state |
| `amber` | `#FFBF2F` | trust-note left border and icon, forecast area circle |
| `blue` | `#3A9DF7` | verdict pill "Still running" border |
| legacy accents | red `#EF2639`, orange `#FF681E`, purple `#9D34DD` | **do not use for risk**. `#EF2639` is only the 4px left border marking serious rows on Track record |

### 1.2 Risk scale (`risk.css`; the ONLY colours that mean a risk level)

| level | fill | ink | shape |
| --- | --- | --- | --- |
| Low | `#22C55E` | `#000000` | filled circle |
| Watch | `#FACC15` | `#000000` | ring (outer disc, transparent band 30% to 58% of the radius, inner disc 0 to 28%) |
| Moderate | `#F97316` | `#000000` | triangle `polygon(50% 0, 100% 100%, 0 100%)` |
| High | `#EF4444` | `#000000` | diamond `polygon(50% 0, 100% 50%, 50% 100%, 0 50%)` |
| Severe | `#B91C1C` | `#FFFFFF` | hexagon `polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)` |
| Extreme | `#7C3AED` | `#FFFFFF` | star `polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%)` |
| Not rated | transparent; 1px border `#2B624E`; text `#91B4A6` | none | hollow circle (1px inset stroke in the text colour) |

The inks were chosen so each one clears **4.5:1** against its own swatch. **Severe (2.6:1) and Extreme (2.9:1) must
never be used as text colour or as a bare border on the dark background.** Use them only as filled swatches with
their ink.

### 1.3 Neutral vocabularies (deliberately not on the risk scale)

| element | border | text | fill |
| --- | --- | --- | --- |
| provenance pill (`.prov`, `.provenance-badge`) | `#2B624E` | `#CFE3DA` | transparent |
| `.provenance` (bold, larger) | `#39715D` | inherit (`text`) | transparent |
| source pill (`.source`) | `#2B624E` | `#9FD0BB` | transparent |
| source status OK / WARN / BAD / MUTED | `#25E29C` / `#E9B949` / `#EF5261` / `#9AA7A2` | `#8FF0CB` / `#F2D894` / `#FFA7B0` / `#C2CFCA` | transparent |
| verdict (home teaser `.verdict`) default | `#9AA7A2` | `#C2CFCA` | transparent |
| verdict verified / partial / false alarm / missed | `#25E29C` / `#E9B949` / `#EF5261` / `#C168FF` | `#8FF0CB` / `#F2D894` / `#FFA7B0` / `#DCB6FF` | transparent |
| Track record `.pill` states: verified, partial, alarm, missed, coverage, open, awaiting, ungradeable, notprediction, unknown | `#25E29C`, `#E9B949`, `#EF5261`, `#C168FF`, `#9AA7A2`, `#3A9DF7`, `#8FA8A0`, `#6F8B82` dashed, `#C168FF` dashed, `#EF5261` | `text` | transparent; base border `#31564A` |
| place-search level chip (`.pc-level`) | `#2D7A5D` | `#9FE9C8` | transparent |
| enrichment tag (`.inteltag`) / verified | `#2B624E` / `#25E29C` | `#9FD0BB` / `#8FF0CA` | transparent |

### 1.4 Message boxes

| box | border | fill | text |
| --- | --- | --- | --- |
| `.notice` (informational amber) | `#66541F` (app-pages `#735C1C`) | `#17160E` (app-pages `#211C0B`) | `#D7CDA5` |
| `.stale` (warning: quiet record, load failure) | `#A96E28` | `#2A1B09` | text |
| trust note `.trust` | 1px `#2B624E`, **3px left `#FFBF2F`** | `#071F18` | `#D9EBE3`; links `#6FE3FF`; the "when" line `#9FBCB0`; status "answered" `#25E29C`, "not answering" `#FFBF2F` |
| action panel (event detail) | 4px left `#FFB15E` | panel | |
| place answer "authority" line | | | `#FFD9A8` |
| empty state `.empty` | | | `#8EAA9F` |

### 1.5 Map

| item | value |
| --- | --- |
| default base ("Map") | ocean `#0E2631`, land `#22342D`, borders `#5F7D70` at 0.6 px and opacity 0.9, country labels `#C7D6CF` 11px/500 |
| "Political" palette | land fills cycle `#F2B880, #9AD4A0, #F4D06F, #A8C8EC, #E8A0A8, #C9B3E6, #8FD5C8`, ocean `#A9D5E8`, borders `#6D7F8C`, labels `#24323D` 11px/600 |
| marker halo | two white drop-shadows (`0 0 1px` and `0 0 .5px`, rgba 255,255,255,.95) around the shape, plus a 1.5px `#0B1F19` outline and `0 1px 3px rgba(0,0,0,.55)` |
| Watch marker | yellow disc with a 2px inset `#0B1F19` ring |
| selected marker | 2px white ring, then 4px `#0B1F19` ring |
| map controls (layers, key) | bg `#06261D` or `#07231B`, border `#156047` or `#2C5C4C`, radius 8; pressed toggle bg `#25E29C` with text `#04120E` |
| location radius circle | stroke `#25E29C` 1px, fill opacity 0.06; centre dot white 2px stroke, fill `#25E29C` |
| forecast area circle | 250 km, stroke `#FFBF2F`, fill opacity 0.08 |

---

## 2. Typography

Web font stack: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`, base `14px/1.4`. Native: **SF Pro**
(iOS) and **Roboto or Inter** (Android). Bundle Inter if you want an exact match.

| role | web | weight | native minimum (pt/sp) |
| --- | --- | --- | --- |
| hero H1 | 34px (28px under 760px) | bold | 28 (Large Title) |
| Track record H1 | clamp(28, 4vw, 48) | bold | 28 |
| place result headline | 15px | bold | 17 |
| panel title (`.ph h2/h3`) | 13px | bold | 15 (Headline) |
| card title (`.event-card h3`) | 13px | bold | 15 |
| body | 13 to 14px | regular | 15 to 17 (Body) |
| card body (`.event-card p`) | 10px, `#ABC7BB` | regular | 13 (Footnote) |
| eyebrow / uppercase label | 9 to 10px, letter-spacing .06 to .16em, uppercase | 800 | 11 (Caption 2), tracking +0.06em |
| risk badge text | 9px, letter-spacing .03em, line-height 1.35, one line | 800 | 11, never wraps |
| pills (`.prov`, `.source`, `.verdict`) | 9px, uppercase for prov and verdict | 800 | 11 |
| KPI number (home) | 22px | bold | 22 |
| Track record metric value | 26px (compact 20px) | bold | 22 |
| stat line number | 17px | bold; label 13px lower-case, muted | 17 / 13 |
| key fact value / label | 14px 800 / 9px uppercase | | 15 / 11 |
| emergency phone number | 24px 850, `#8FF0CA` | | 24 |
| footer | 12px `#9FBCB0` | | 13 |
| trust note | 13px (12.5px on phone), "when" and sources 12px | | 13 / 12 |

Numbers in tables and keys use tabular figures (`font-variant-numeric: tabular-nums` on the map key).

---

## 3. Risk badge and marker components

### 3.1 Risk badge (`.risk`)
- Capsule-ish shape: **corner radius 7**, padding `3 × 7`, inline. The shape glyph is drawn at **0.72em**, with a
  0.45em gap before the text, in the ink colour. The text is the level label (or a provider word on legacy chips).
- Always a single line (`white-space: nowrap`), so it never wraps letter by letter.
- Unknown: transparent background, 1px `#2B624E` border, muted text, hollow-circle glyph, text "Not rated" (or
  "Nothing reported nearby" on place answers).
- Draw the shape from vector paths, not a font glyph, so screen readers do not read it. Expose the accessibility label from the badge title (logic.md §2.3).
- SwiftUI: `HStack(spacing: 0.45em) { RiskShape(level).fill(ink).frame(0.72em) ; Text(label) }.padding(3,7).background(fill, in: RoundedRectangle(7))`.
  Compose: `Row` with `Canvas` drawing the polygon, and `Modifier.background(fill, RoundedCornerShape(7.dp))`.

### 3.2 Shapes (unit square, origin at the top left)
- circle: an ellipse in the rect
- ring: the full disc in ink, minus an annulus between radius 0.30 and 0.58, with the centre disc at radius ≤0.28 (as in the radial gradient)
- triangle: (0.5,0) (1,1) (0,1)
- diamond: (0.5,0) (1,0.5) (0.5,1) (0,0.5)
- hexagon: (0.25,0) (0.75,0) (1,0.5) (0.75,1) (0.25,1) (0,0.5)
- star: (0.5,0) (0.61,0.39) (1,0.5) (0.61,0.61) (0.5,1) (0.39,0.61) (0,0.5) (0.39,0.39)
- hollow circle: a 1px stroke circle

### 3.3 Map marker
- Size `9 + rank*3` (Low 12 up to Extreme 27; Unknown 9), filled with the level colour, with the halo and outline from
  §1.5, and z-index `rank*1000`. Unknown markers are filled `#8FA8A0`.
- Use clustering only if it never hides a higher level under lower ones (the website does not cluster).
- **Map key** button: label "Key", pressed state green. Its body is `rgba(4,18,14,.92)` with a 1px `#1F4A3C`
  border and radius 10. It lists each level with its mark and the count drawn, using muted tabular numbers.

---

## 4. Components

### 4.1 App bar / header (`.top`)
- Height ≥ 58, background `rgba(2,17,13,.97)`, bottom border `line2`. Sticky.
- Logo: an outlined globe (38 × 38 circle, 2px `green` stroke with meridian and parallel lines; on portal pages the
  glyph "◎" at 32px in `green`), then **"Predict Natural Disasters"** (18px 850) and the tagline "Check a place ·
  live hazards · forecasts" (9px `#CBE5DA`).
- Right side: timezone picker (bg `#09231B`, border `#285F4B`, radius 8, 11px) and the "● Live" chip (border
  `#187858`, bg `#06251B`, text `#65E7B6`, radius 8, 800 weight, padding 8×11).

### 4.2 Bottom tab bar (phone, under 760px)
- Fixed to the bottom. Background `rgba(2,17,13,.98)`, top border `#174638`, shadow `0 -6px 18px rgba(0,0,0,.35)`,
  and padding for the bottom safe area.
- Five equal items: **Map · Alerts & events · Forecasts · My places · Track record**, text 11px centred, line height 1.15, padding `10 2 9`, two-line wrap allowed.
- Inactive text `#E6F4EE`. **Active: 2px top border `#25E29C` and text `#8FF0CA`.** No icons on the web; native may
  add SF Symbols or Material icons (suggested: map, exclamationmark.triangle, chart.line.uptrend, mappin.and.ellipse,
  checkmark.seal). Keep the labels.
- Content gets bottom padding of `58 + safe area`.

### 4.3 Pills
- `.prov` / provenance: radius 999, padding `2 × 7`, border `#2B624E`, text `#CFE3DA`, 9px 800, uppercase, tracking .04em.
- `.provenance`: radius 999, padding `4 × 8`, border `#39715D`, 10px 900, tracking .06em.
- `.source`: radius 999, padding `2 × 6`, border `#2B624E`, text `#9FD0BB`, 9px. It shows `shortSource` (at most 28 chars), with the full name as its accessibility label.
- `.verdict`: radius 999, padding `3 × 8`, 9px 800 uppercase, colours from §1.3.
- Track record `.pill`: radius 999, padding `6 × 9`, 11px 800, border per state.

### 4.4 Panel (`.panel`) and panel header (`.ph`)
- Gradient `#07251B` → `#051B14`, 1px `#1D654C` border, **radius 10**, clipped, 10 bottom margin.
- Header: padding `10 × 12`, bottom border `#1B5745`, row layout `title (13px bold, flex) · right-aligned "View all →" link (11px #EAF7F0)` and optional controls. Wraps on narrow screens.

### 4.5 Card / event card
- `.card` / `.event-card`: bg `#09231B`, 1px `#285C49`, **radius 9**, padding 11 or 12. Pressed or hover border `#35D79A`.
- Layout: a pill row (risk badge, source pill, provenance pills) with 6px gaps; then the title (13px bold, top margin
  7, bottom 4); then the body (10px `#ABC7BB`); then the footer (muted small).
- Grid: 3 columns on desktop, 2 under 1100px, 1 under 760px, with 10px gaps and 10px padding. Native phone: one column.

### 4.6 Stat line and KPI tiles
- Hero stat line (`.stats.statline`): inline items with gaps of 4 × 18, each `<number 17px bold> <label 13px lower-case muted>`. A `.lead` item puts the label first ("updated 2 min ago").
- Home KPI tile (`.kpi`): bg `#072B20`, 1px `#176148`, radius 10, min height 78, padding `10 × 13`; number 22px;
  label 11px; delta 10px `#87AA9B`. Loading: a shimmer bar (`#0C3326` / `#17563F` / `#0C3326` gradient, 1.1 s
  linear, disabled when Reduce Motion is on) in place of the number.
- Track record `.metric`: bg `#071C16`, 1px `#183F33`, radius 12, padding 16 (compact 10×12); label 11px uppercase
  `#8EAA9F` tracking .08em; value 26px bold (compact 20). Grid: 4 columns (compact 5), 2 under 850px, 1 under 480px.

### 4.7 Key facts grid (`.keyfacts`)
Adaptive grid (`minmax(150, 1fr)`) with 6px gaps. Tile: bg `#08251C`, 1px `#1B5745`, radius 8, padding `8 × 9`;
label 9px uppercase `#8FB0A2`; value 14px 800 `#EAF7F1`. A **missing** value ("Not reported") is 11px 600 `#9FB8AD`.

### 4.8 Buttons and inputs
- Default (`.btn`, `.input`, `.select`): bg `#09251D`, 1px `#285F4B`, text `#EEF8F3`, **radius 8**, padding `10 × 12`. Search input minimum width 280, full width on a phone.
- Primary ("Check risk", "Save place"): bg `#25E29C`, text `#04120E`, radius 9, padding `13 × 20`, 800 15px. Disabled: opacity 0.6.
- Secondary on a place result: bg `#0B3E2E`, 1px `#2E6B55`, text `#EAF7F1`, radius 9, padding `10 × 14`, 700 13px.
- Outline pill ("Use my location", saved-place chips): transparent, 1px `#2B624E`, text `#8FF0CA`, radius 999, padding `6 × 12`, 12px 700.
- Home check input: bg `#06130F`, 1px `#2E6B55`, radius 9, padding `13 × 14`, 15px.
- Track record controls: bg `#06130F`, 1px `#31564A`, radius 8, padding 10.
- Focus ring: 2px `#6FE3FF` outline at offset 2 (links), or `#25E29C` (map controls).

### 4.9 Place result card (Home)
bg `#07251B`, 1px `#1D654C`, **radius 12**, padding 14, max width 940. Eyebrow 10px uppercase `#8EAA9F` tracking
.12em. Badge and headline in one row. Block headings 10px 800 uppercase `#8EAA9F` tracking .09em; block text 13px
`#DCECE4` line-height 1.5. Actions are a wrap row with 8 gaps.

### 4.10 Place chooser (`.placechoices`)
A heading "Which place do you mean?" (13px 700 `#D9EFE6`), then one button per candidate: bg `#07251B`, 1px
`#1D654C`, radius 10, padding `9 × 12`. The name is 700 `#EAFFF6` and the level chip is right-aligned (§1.3). The
full address below is 11px `#9DB9AD`. Focused or pressed border `#25E29C`.

### 4.11 Forecast table, phone fold (`.ftable` under 760px)
Each row is a card: bg `#08211A`, 1px `#1B5745`, radius 9, padding `8 0`, 8 bottom margin. Each cell is a row of
`LABEL (9px uppercase #8EAA9E)` on the left and the value on the right, padding `3 × 11`. The cells shown are
**Risk, Forecast, Place, Hazard, Kind of forecast, Dates, Status**. Place is clamped to 3 lines.

### 4.12 Forecast calendar
Label column 190 (118 on phone), track minimum width 520 (scroll horizontally). Day header 10px `#9EC7B6` with the
day number 13px; today's column bg `#0C3527` with the number in `#7EF0C0`. Group name 11px uppercase tracking .12em
`#7FD8B4`. Track bg `#082A20`, radius 6, height 26. Bar: inset 3, radius 5, 11px 600, filled with the risk colour and
ink (bars without a level are `#5FD3A6`). A live bar gets a 2px `#7EF0C0` ring. The "now" line is 2px `#7EF0C0`.

### 4.13 Trust note (top of screen)
Margin bottom 12, padding `9 × 12`, radius 10, borders as in §1.4. First row: an 18px circle "i" icon (1.5px
`#FFBF2F` stroke, italic serif "i" 12px `#FFBF2F`), then **bold "Experimental model, not an official warning."**
followed by the agency links. Then the "when" line, indented 26 (0 on phone), 12px `#9FBCB0`. Then a disclosure
"Data sources (N): …" with summary text `#8FF0CA`, list items 12px, and the "adds" sentence in `#C4D8CF`.

### 4.14 Footer (`.sitefoot` + `.trust-foot`)
bg `#03140F`, top border `#174638`, padding 16, 12px `#9FBCB0`. Nav links `#8FF0CA` in a wrap row with gaps of 8 ×
16. Then the agency list (max width 90ch): region labels 600 `#E6F2EC`, links `#8FF0CA`, small domain text `#9FBCB0`.

### 4.15 Enrichment panels
3-column grid (1 column on phone) with 9 gaps and 10 padding, cards at least 110 tall. Key/value list: 190px label
column (stacked on phone), labels 12px `#89AB9D`, values 13px. Video thumbnail 16:9, radius 6, bg `#062018`. Phone
number 24px 850 `#8FF0CA`. Meta text 10px `#91B4A6`. List items 12px `#CFE7DD`.

### 4.16 Tables
11px. Header 9px uppercase `#8EAA9E` tracking .06em. Cell padding `8 × 10`, row divider `#153F33`. A tappable row
highlights `#0B3125`. Track record ledger rows have padding `11 × 9` and dividers `#17372E`. Serious rows get a 4px
left border `#EF2639`.

---

## 5. Spacing and radii summary

| token | value |
| --- | --- |
| page gutter | 16 (10 on phone); hero padding `22 18 18` |
| section gap | 10 (panels and grids); Track record sections 14 margin, 18 padding |
| radius | badge 7, input or button 8, card 9, panel 10, place result, metric and section 12, pill 999 |
| border width | 1 (4 for the action-panel accent and serious rows; 3 for the trust-note accent) |
| hit target | native minimum 44pt / 48dp. The web tab items are about 40 tall, so pad them up |

## 6. Motion and accessibility
- Only two animations exist: the KPI shimmer and the map "fly to" (0.55 s). Respect Reduce Motion.
- Every level shows colour, text and shape. Every pill keeps its full meaning in its accessibility label (the full source name, or the badge title sentence).
- Link colours clear 7:1. Risk inks clear 4.5:1. The test suite (`test/contrast.test.js`, `riskcolour.test.js`) enforces both. Native should add the same contrast assertions to UI tests.
- Do not expand acronyms inside badges, pills, headings or cards (glossary rule). Expand them in body prose.
