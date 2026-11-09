package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.el
import com.anchittandon.pnd.model.truthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/**
 * country-names.js (changelog C36): one name for each country, wherever the app groups or counts by country,
 * ocean features moved into `sea`, and places matched exactly. The tables are copied verbatim from the website.
 */
object CountryNames {
    /** Spellings of one country, all mapped to the name we show. Lower-cased keys. */
    val ALIASES: Map<String, String> = linkedMapOf(
        "mx" to "Mexico",
        "méxico" to "Mexico",
        "mexico" to "Mexico",
        "us" to "United States",
        "u.s." to "United States",
        "usa" to "United States",
        "u.s.a." to "United States",
        "united states of america" to "United States",
        "united states" to "United States",
        "uk" to "United Kingdom",
        "great britain" to "United Kingdom",
        "britain" to "United Kingdom",
        "united kingdom of great britain and northern ireland" to "United Kingdom",
        "iran" to "Iran",
        "islamic republic of iran" to "Iran",
        "iran, islamic republic of" to "Iran",
        "iran (islamic republic of)" to "Iran",
        "myanmar" to "Myanmar",
        "burma" to "Myanmar",
        "burma (myanmar)" to "Myanmar",
        "myanmar (burma)" to "Myanmar",
        "russia" to "Russia",
        "russian federation" to "Russia",
        "vietnam" to "Vietnam",
        "viet nam" to "Vietnam",
        "laos" to "Laos",
        "lao pdr" to "Laos",
        "lao people's democratic republic" to "Laos",
        "syria" to "Syria",
        "syrian arab republic" to "Syria",
        "south korea" to "South Korea",
        "korea, republic of" to "South Korea",
        "republic of korea" to "South Korea",
        "north korea" to "North Korea",
        "democratic people's republic of korea" to "North Korea",
        "dprk" to "North Korea",
        "korea, democratic people's republic of" to "North Korea",
        "tanzania" to "Tanzania",
        "united republic of tanzania" to "Tanzania",
        "tanzania, united republic of" to "Tanzania",
        "bolivia" to "Bolivia",
        "bolivia (plurinational state of)" to "Bolivia",
        "plurinational state of bolivia" to "Bolivia",
        "venezuela" to "Venezuela",
        "venezuela (bolivarian republic of)" to "Venezuela",
        "bolivarian republic of venezuela" to "Venezuela",
        "moldova" to "Moldova",
        "republic of moldova" to "Moldova",
        "moldova, republic of" to "Moldova",
        "brunei" to "Brunei",
        "brunei darussalam" to "Brunei",
        "türkiye" to "Türkiye",
        "turkiye" to "Türkiye",
        "turkey" to "Türkiye",
        "czechia" to "Czechia",
        "czech republic" to "Czechia",
        "cabo verde" to "Cabo Verde",
        "cape verde" to "Cabo Verde",
        "côte d'ivoire" to "Côte d'Ivoire",
        "cote d'ivoire" to "Côte d'Ivoire",
        "ivory coast" to "Côte d'Ivoire",
        "timor-leste" to "Timor-Leste",
        "timor leste" to "Timor-Leste",
        "east timor" to "Timor-Leste",
        "north macedonia" to "North Macedonia",
        "macedonia" to "North Macedonia",
        "the republic of north macedonia" to "North Macedonia",
        "republic of north macedonia" to "North Macedonia",
        "bosnia and herzegovina" to "Bosnia and Herzegovina",
        "bosnia & herzegovina" to "Bosnia and Herzegovina",
        "bosnia and herz." to "Bosnia and Herzegovina",
        "eswatini" to "Eswatini",
        "swaziland" to "Eswatini",
        "democratic republic of the congo" to "Democratic Republic of the Congo",
        "democratic republic of congo" to "Democratic Republic of the Congo",
        "dem. rep. congo" to "Democratic Republic of the Congo",
        "dr congo" to "Democratic Republic of the Congo",
        "drc" to "Democratic Republic of the Congo",
        "congo-kinshasa" to "Democratic Republic of the Congo",
        "congo, the democratic republic of the" to "Democratic Republic of the Congo",
        "republic of the congo" to "Republic of the Congo",
        "republic of congo" to "Republic of the Congo",
        "congo" to "Republic of the Congo",
        "congo-brazzaville" to "Republic of the Congo",
        "central african rep." to "Central African Republic",
        "dominican rep." to "Dominican Republic",
        "eq. guinea" to "Equatorial Guinea",
        "falkland is." to "Falkland Islands",
        "s. sudan" to "South Sudan",
        "solomon is." to "Solomon Islands",
        "w. sahara" to "Western Sahara",
        "n. cyprus" to "Northern Cyprus",
        "fr. s. antarctic lands" to "French Southern Territories",
        "french southern and antarctic lands" to "French Southern Territories",
        "the gambia" to "Gambia",
        "the bahamas" to "Bahamas",
        "philippines (the)" to "Philippines",
        "micronesia (federated states of)" to "Micronesia",
        "federated states of micronesia" to "Micronesia",
        "palestine, state of" to "Palestine",
        "state of palestine" to "Palestine",
        "occupied palestinian territory" to "Palestine",
        "curacao" to "Curaçao",
        "reunion" to "Réunion",
        "sao tome and principe" to "São Tomé and Príncipe",
        "uae" to "United Arab Emirates",
        "hong kong sar" to "Hong Kong",
        "macao" to "Macau",
        "us virgin islands" to "U.S. Virgin Islands",
        "taiwan, province of china" to "Taiwan",
        "vanuatu islands" to "Vanuatu",
        "fiji islands" to "Fiji",
        "tonga islands" to "Tonga",
        "samoa islands" to "Samoa",
        "mariana islands" to "Northern Mariana Islands",
        "southern india" to "India",
    )

    /** Parts of a country that providers name in its place. Used to group a record under its country only. */
    val PARTS: Map<String, String> = linkedMapOf(
        "alaska" to "United States",
        "aleutian islands" to "United States",
        "rat islands" to "United States",
        "andreanof islands" to "United States",
        "fox islands" to "United States",
        "unimak island" to "United States",
        "near islands" to "United States",
        "hawaii" to "United States",
        "island of hawaii" to "United States",
        "bonin islands" to "Japan",
        "izu islands" to "Japan",
        "ryukyu islands" to "Japan",
        "volcano islands" to "Japan",
        "hokkaido" to "Japan",
        "honshu" to "Japan",
        "kyushu" to "Japan",
        "shikoku" to "Japan",
        "kuril islands" to "Russia",
        "kamchatka" to "Russia",
        "komandorskiye ostrova" to "Russia",
        "kermadec islands" to "New Zealand",
        "north island" to "New Zealand",
        "south island" to "New Zealand",
        "santa cruz islands" to "Solomon Islands",
        "loyalty islands" to "New Caledonia",
        "sumatra" to "Indonesia",
        "java" to "Indonesia",
        "sulawesi" to "Indonesia",
        "halmahera" to "Indonesia",
        "mindanao" to "Philippines",
        "luzon" to "Philippines",
        "crete" to "Greece",
        "sicily" to "Italy",
        "tibet" to "China",
        "xizang" to "China",
        "xinjiang" to "China",
        "easter island" to "Chile",
    )

    /** Every other country or territory, spelled as we show it. */
    val NAMES: List<String> = ("Afghanistan|Albania|Algeria|American Samoa|Andorra|Angola|Anguilla|Antarctica|Antigua and Barbuda|Argentina|" +
        "Armenia|Aruba|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|" +
        "Bermuda|Bhutan|Botswana|Brazil|British Virgin Islands|Bulgaria|Burkina Faso|Burundi|Cambodia|Cameroon|Canada|" +
        "Cayman Islands|Chad|Chile|China|Colombia|Comoros|Cook Islands|Costa Rica|Croatia|Cuba|Cyprus|Denmark|Djibouti|" +
        "Dominica|Ecuador|Egypt|El Salvador|Eritrea|Estonia|Ethiopia|Faroe Islands|Fiji|Finland|France|French Guiana|" +
        "French Polynesia|Gabon|Gambia|Georgia|Germany|Ghana|Gibraltar|Greece|Greenland|Grenada|Guadeloupe|Guam|" +
        "Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hong Kong|Hungary|Iceland|India|Indonesia|Iraq|Ireland|" +
        "Israel|Italy|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Kosovo|Kuwait|Kyrgyzstan|Latvia|Lebanon|Lesotho|" +
        "Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Macau|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|" +
        "Marshall Islands|Martinique|Mauritania|Mauritius|Mayotte|Monaco|Mongolia|Montenegro|Montserrat|Morocco|" +
        "Mozambique|Namibia|Nauru|Nepal|Netherlands|New Caledonia|New Zealand|Nicaragua|Niger|Nigeria|Niue|" +
        "Norfolk Island|Northern Mariana Islands|Norway|Oman|Pakistan|Palau|Panama|Papua New Guinea|Paraguay|Peru|" +
        "Philippines|Pitcairn Islands|Poland|Portugal|Puerto Rico|Qatar|Romania|Rwanda|Saint Barthélemy|Saint Helena|" +
        "Saint Kitts and Nevis|Saint Lucia|Saint Martin|Saint Pierre and Miquelon|Saint Vincent and the Grenadines|" +
        "Samoa|San Marino|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Sint Maarten|Slovakia|Slovenia|" +
        "Somalia|Somaliland|South Africa|South Georgia and the South Sandwich Islands|South Sudan|Spain|Sri Lanka|Sudan|" +
        "Suriname|Sweden|Switzerland|Taiwan|Tajikistan|Thailand|Togo|Tokelau|Trinidad and Tobago|Tunisia|Turkmenistan|" +
        "Turks and Caicos Islands|Tuvalu|Uganda|Ukraine|United Arab Emirates|Uruguay|Uzbekistan|Vatican City|" +
        "Wallis and Futuna|Yemen|Zambia|Zimbabwe|United States Minor Outlying Islands").split('|')

    private val KNOWN: Map<String, String> = HashMap<String, String>().also { m ->
        NAMES.forEach { m[it.lowercase(Locale.ROOT)] = it }
        ALIASES.forEach { (k, v) -> m[k] = v; m[v.lowercase(Locale.ROOT)] = v }
    }

    const val AT_SEA = "At sea"

    private fun tidy(v: String?): String =
        (v ?: "").replace(Regex("\\s+"), " ").replace(Regex("^[\\s,;]+|[\\s,;.]+$"), "").trim()

    /** The one spelling of a country, or "" when the name is not one we know. */
    fun canonical(name: String?): String {
        val k = tidy(name).lowercase(Locale.ROOT)
        return if (k.isEmpty()) "" else KNOWN[k] ?: ""
    }

    private val SEA_WORDS = Regex("\\b(ridge|rise|ocean|sea|gulf|bay|strait|trench|fracture zone|basin|passage|channel|plateau|seamount|abyssal)\\b", RegexOption.IGNORE_CASE)
    private val OFFSHORE = Regex("^(north|south|east|west|northeast|northwest|southeast|southwest|northern|southern|eastern|western|central|off|near)( of)?(\\s+the)?(\\s+coast of)?\\s+", RegexOption.IGNORE_CASE)

    /** Where one name puts a record: a country on land, or a sea. */
    data class At(val country: String? = null, val sea: String? = null)

    fun locate(name: String?): At {
        val raw = tidy(name)
        if (raw.isEmpty()) return At()
        canonical(raw).let { if (it.isNotEmpty()) return At(country = it) }
        PARTS[raw.lowercase(Locale.ROOT)]?.let { return At(country = it) }
        Regex("^(.*?)\\s+region$", RegexOption.IGNORE_CASE).find(raw)?.let { m ->
            val r = m.groupValues[1]
            val inner = canonical(r).ifEmpty { PARTS[r.lowercase(Locale.ROOT)] ?: "" }
            return if (inner.isNotEmpty()) At(country = inner) else At(sea = raw)
        }
        if (OFFSHORE.containsMatchIn(raw) || SEA_WORDS.containsMatchIn(raw)) return At(sea = raw)
        return At(country = raw)
    }

    data class Place(val countries: List<String>, val sea: String? = null)

    /** A list of names as countries, with any ocean feature moved to `sea` (set only when no country remains). */
    fun place(names: List<String>): Place {
        val countries = mutableListOf<String>()
        var sea = ""
        names.forEach { n ->
            val at = locate(n)
            if (at.country != null && at.country !in countries) countries += at.country
            else if (at.sea != null && sea.isEmpty()) sea = at.sea
        }
        return Place(countries, if (countries.isEmpty() && sea.isNotEmpty()) sea else null)
    }

    private fun jsString(v: kotlinx.serialization.json.JsonElement): String = when (v) {
        is JsonNull -> "null"
        is JsonPrimitive -> v.content
        is JsonArray -> v.joinToString(",") { jsString(it) }
        else -> "[object Object]"
    }

    /** A record's countries: the feed's `countries` list, else its country (or affectedCountries) field. */
    fun of(e: JsonObject?): Place {
        if (e == null) return Place(emptyList())
        val listed = e.arr("countries")?.takeIf { it.isNotEmpty() }?.map { jsString(it) }
            ?: (listOf("country", "affectedCountries").firstOrNull { e.truthy(it) }?.let { k -> e.el(k)?.let { jsString(it) } } ?: "").split(',')
        val p = place(listed)
        if (p.countries.isEmpty() && p.sea == null && e.truthy("sea")) return Place(p.countries, e.el("sea")?.let { jsString(it) })
        return p
    }

    /** How many countries a list of records names: each one once, by its one name. */
    fun countryCount(list: List<JsonObject>): Int {
        val seen = HashSet<String>()
        list.forEach { e -> of(e).countries.forEach { seen += it.lowercase(Locale.ROOT) } }
        return seen.size
    }

    /** A whole-word test, so Niger is not Nigeria and India is not "Indian". */
    fun wholeWord(text: String?, word: String?): Boolean {
        val w = tidy(word)
        if (w.isEmpty()) return false
        return Regex("(^|[^\\p{L}\\p{N}])" + Regex.escape(w) + "(?=$|[^\\p{L}\\p{N}])", setOf(RegexOption.IGNORE_CASE)).containsMatchIn(text ?: "")
    }

    private val PLACE_FIELDS = listOf("country", "affectedCountries", "region", "location", "place", "sea")

    /**
     * Is this record in the place named? A country exactly, by its one name, against the record's countries; anything
     * else as a whole word in its place fields, never its title or description. An empty place is everywhere.
     */
    fun inPlace(e: JsonObject?, q: String?): Boolean {
        val want = tidy(q)
        if (e == null) return false
        if (want.isEmpty()) return true
        if (want.lowercase(Locale.ROOT) == AT_SEA.lowercase(Locale.ROOT)) return of(e).countries.isEmpty()
        val mine = of(e)
        val c = canonical(want)
        if (c.isNotEmpty() && mine.countries.isNotEmpty()) return c in mine.countries
        val text = PLACE_FIELDS.mapNotNull { k -> e.el(k)?.let { v -> if (v is JsonPrimitive && v.isString && v.content.isEmpty()) null else jsString(v) } }.joinToString(" • ")
        if (wholeWord(text, want)) return true
        return c.isEmpty() && mine.countries.any { it.lowercase(Locale.ROOT) == want.lowercase(Locale.ROOT) }
    }
}
