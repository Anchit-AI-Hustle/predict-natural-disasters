package com.anchittandon.pnd.logic

import com.anchittandon.pnd.model.arr
import com.anchittandon.pnd.model.el
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/**
 * continents.js (logic.md §6.12): a continent is the countries on it. A record is on every
 * continent one of its countries is on; a record that names no country is on none. The name
 * lists are copied verbatim from continents.js.
 */
object Continents {
    private val C: LinkedHashMap<String, String> = linkedMapOf(
        "Africa" to "Algeria|Angola|Benin|Botswana|Burkina Faso|Burundi|Cameroon|Cape Verde|Cabo Verde|Central African Rep.|Central African Republic|Chad|Comoros|Congo|Republic of Congo|Republic of the Congo|Congo-Brazzaville|Dem. Rep. Congo|Democratic Republic of Congo|Democratic Republic of the Congo|DR Congo|Congo-Kinshasa|Côte d'Ivoire|Cote d'Ivoire|Ivory Coast|Djibouti|Egypt|Eq. Guinea|Equatorial Guinea|Eritrea|eSwatini|Eswatini|Swaziland|Ethiopia|Gabon|Gambia|The Gambia|Ghana|Guinea|Guinea-Bissau|Kenya|Lesotho|Liberia|Libya|Madagascar|Malawi|Mali|Mauritania|Mauritius|Mayotte|Morocco|Mozambique|Namibia|Niger|Nigeria|Réunion|Reunion|Rwanda|Saint Helena|São Tomé and Príncipe|Sao Tome and Principe|Senegal|Seychelles|Sierra Leone|Somalia|Somaliland|South Africa|S. Sudan|South Sudan|Sudan|Tanzania|Togo|Tunisia|Uganda|W. Sahara|Western Sahara|Zambia|Zimbabwe",
        "Asia" to "Afghanistan|Armenia|Azerbaijan|Bahrain|Bangladesh|Bhutan|Brunei|Cambodia|China|Hong Kong|Macau|Macao|Georgia|India|Southern India|Indonesia|Iran|Iraq|Israel|Japan|Jordan|Kazakhstan|Kuwait|Kyrgyzstan|Laos|Lebanon|Malaysia|Maldives|Mongolia|Myanmar|Burma|Nepal|North Korea|Oman|Pakistan|Palestine|Philippines|Qatar|Saudi Arabia|Singapore|South Korea|Korea|Sri Lanka|Syria|Taiwan|Tajikistan|Thailand|Timor-Leste|Timor Leste|East Timor|Turkey|Türkiye|Turkiye|Turkmenistan|United Arab Emirates|UAE|Uzbekistan|Vietnam|Viet Nam|Yemen|N. Cyprus|Northern Cyprus|Cyprus|Russia|Russian Federation",
        "Europe" to "Albania|Andorra|Austria|Belarus|Belgium|Bosnia and Herz.|Bosnia and Herzegovina|Bosnia & Herzegovina|Bulgaria|Croatia|Czechia|Czech Republic|Denmark|Estonia|Faroe Islands|Finland|France|Germany|Gibraltar|Greece|Hungary|Iceland|Ireland|Italy|Kosovo|Latvia|Liechtenstein|Lithuania|Luxembourg|Macedonia|North Macedonia|Malta|Moldova|Monaco|Montenegro|Netherlands|Norway|Poland|Portugal|Romania|Russia|Russian Federation|San Marino|Serbia|Slovakia|Slovenia|Spain|Sweden|Switzerland|Ukraine|United Kingdom|UK|Vatican City|Turkey|Türkiye|Turkiye|Georgia|Armenia|Azerbaijan|Kazakhstan|Cyprus|N. Cyprus|Northern Cyprus",
        "North America" to "Anguilla|Antigua and Barbuda|Aruba|Bahamas|The Bahamas|Barbados|Belize|Bermuda|British Virgin Islands|Canada|Cayman Islands|Costa Rica|Cuba|Curaçao|Curacao|Dominica|Dominican Rep.|Dominican Republic|El Salvador|Greenland|Grenada|Guadeloupe|Guatemala|Haiti|Honduras|Jamaica|Martinique|Mexico|México|MX|Montserrat|Nicaragua|Panama|Puerto Rico|Saint Barthélemy|Saint Kitts and Nevis|Saint Lucia|Saint Martin|Saint Pierre and Miquelon|Saint Vincent and the Grenadines|Sint Maarten|Trinidad and Tobago|Turks and Caicos Islands|United States|United States of America|USA|US|U.S. Virgin Islands|US Virgin Islands",
        "South America" to "Argentina|Bolivia|Brazil|Chile|Colombia|Ecuador|Falkland Is.|Falkland Islands|French Guiana|Guyana|Paraguay|Peru|South Georgia and the South Sandwich Islands|South Sandwich Islands|Suriname|Uruguay|Venezuela",
        "Oceania" to "American Samoa|Australia|Cook Islands|Fiji|French Polynesia|Guam|Kiribati|Marshall Islands|Micronesia|Nauru|New Caledonia|New Zealand|Niue|Norfolk Island|Northern Mariana Islands|Palau|Papua New Guinea|Pitcairn Islands|Samoa|Solomon Is.|Solomon Islands|Tokelau|Tonga|Tuvalu|Vanuatu|Wallis and Futuna",
        "Antarctica" to "Antarctica|Fr. S. Antarctic Lands|French Southern Territories|French Southern and Antarctic Lands",
    )

    val NAMES: List<String> = C.keys.toList()

    private val BY_COUNTRY: Map<String, List<String>> = LinkedHashMap<String, MutableList<String>>().also { m ->
        NAMES.forEach { k -> C.getValue(k).split('|').forEach { n -> val l = m.getOrPut(n.lowercase(Locale.ROOT)) { mutableListOf() }; if (k !in l) l += k } }
    }

    /** The NAMES entry equal to the trimmed name ignoring case, else "" (no URL decoding). */
    fun continentNamed(name: String?): String {
        val n = (name ?: "").trim().lowercase(Locale.ROOT)
        return NAMES.firstOrNull { it.lowercase(Locale.ROOT) == n } ?: ""
    }

    private fun jsString(v: kotlinx.serialization.json.JsonElement): String = when (v) {
        is JsonNull -> "null"
        is JsonPrimitive -> v.content
        is JsonArray -> v.joinToString(",") { jsString(it) }
        else -> "[object Object]"
    }

    /** `countries[]` (when a non-empty array) plus the comma-split `country`, each with a trailing " region" removed. */
    fun countriesOf(e: JsonObject?): List<String> {
        val list = mutableListOf<String>()
        e.arr("countries")?.takeIf { it.isNotEmpty() }?.forEach { list += jsString(it) }
        val country = e.el("country")?.let { if (com.anchittandon.pnd.model.truthy(it)) jsString(it) else "" } ?: ""
        country.split(',').forEach { if (it.trim().isNotEmpty()) list += it }
        return list.map { it.trim().replace(Regex("\\s+region$", RegexOption.IGNORE_CASE), "") }.filter { it.isNotEmpty() }
    }

    fun continentsOf(e: JsonObject?): List<String> {
        val out = mutableListOf<String>()
        countriesOf(e).forEach { c -> BY_COUNTRY[c.lowercase(Locale.ROOT)]?.forEach { k -> if (k !in out) out += k } }
        return out
    }

    fun onContinent(e: JsonObject?, name: String?): Boolean {
        val k = continentNamed(name)
        return k.isNotEmpty() && k in continentsOf(e)
    }
}
