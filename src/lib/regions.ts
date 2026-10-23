/**
 * Where "region" means on the admin overview: a coarse bucket derived from each account's IANA timezone (`User.timezone`).
 *
 * This is the only per-user geography with real coverage (shop regions are pricing prefs almost nobody picks; the HCA address country is encrypted PII held for one account). Buckets follow IANA areas rather than a curated country list, so there is nothing to maintain as signups spread – and nothing to mislabel. `other` is valid-but-placeless zones (Etc, GMT, the POSIX-style ones); `unknown` is no timezone on file.
 */
type RegionId = "americas" | "europe" | "asia" | "africa" | "oceania" | "other" | "unknown"

const REGIONS: { id: RegionId; label: string }[] = [
	{ id: "americas", label: "Americas" },
	{ id: "europe", label: "Europe" },
	{ id: "asia", label: "Asia" },
	{ id: "africa", label: "Africa" },
	{ id: "oceania", label: "Oceania" },
	{ id: "other", label: "Other" },
	{ id: "unknown", label: "Unknown" },
]

function regionOfTimezone(timezone: string | null | undefined): RegionId {
	if (!timezone) return "unknown"
	switch (timezone.split("/")[0]) {
		case "America":
		case "US":
		case "Canada":
		case "Mexico":
		case "Brazil":
		case "Chile":
		case "EST":
		case "MST":
		case "HST":
		case "EST5EDT":
		case "CST6CDT":
		case "MST7MDT":
		case "PST8PDT":
			return "americas"
		case "Europe":
		case "GB":
		case "GB-Eire":
		case "WET":
		case "CET":
		case "MET":
		case "EET":
		case "W-SU":
			return "europe"
		case "Asia":
		case "PRC":
		case "ROC":
		case "ROK":
			return "asia"
		case "Africa":
			return "africa"
		case "Australia":
		case "Pacific":
		case "NZ":
			return "oceania"
		case undefined:
			return "other"
		default:
			return "other"
	}
}

/**
 * IANA zone to country, for the country breakdown. Covers every timezone on file plus the common aliases browsers report (e.g. both Kathmandu spellings); anything else falls to Unknown so a new zone shows up as unplaced rather than mislabeled – extend the map when it does.
 */
const ZONE_COUNTRY: { [_: string]: string } = {
	"Africa/Accra": "Ghana",
	"Africa/Addis_Ababa": "Ethiopia",
	"Africa/Algiers": "Algeria",
	"Africa/Blantyre": "Malawi",
	// Africa
	"Africa/Cairo": "Egypt",
	"Africa/Casablanca": "Morocco",
	"Africa/Dar_es_Salaam": "Tanzania",
	"Africa/Douala": "Cameroon",
	"Africa/Harare": "Zimbabwe",
	"Africa/Johannesburg": "South Africa",
	"Africa/Kampala": "Uganda",
	"Africa/Kigali": "Rwanda",
	"Africa/Lagos": "Nigeria",
	"Africa/Lusaka": "Zambia",
	"Africa/Mbabane": "Eswatini",
	"Africa/Nairobi": "Kenya",
	"Africa/Tunis": "Tunisia",
	"Africa/Windhoek": "Namibia",
	"America/Anchorage": "United States",
	"America/Argentina/Buenos_Aires": "Argentina",
	"America/Bogota": "Colombia",
	"America/Boise": "United States",
	"America/Buenos_Aires": "Argentina",
	"America/Caracas": "Venezuela",
	"America/Chicago": "United States",
	"America/Costa_Rica": "Costa Rica",
	"America/Denver": "United States",
	"America/Detroit": "United States",
	"America/Dominica": "Dominica",
	"America/Edmonton": "Canada",
	"America/Fortaleza": "Brazil",
	"America/Guatemala": "Guatemala",
	"America/Guayaquil": "Ecuador",
	"America/Halifax": "Canada",
	"America/Indianapolis": "United States",
	"America/Jamaica": "Jamaica",
	"America/Jujuy": "Argentina",
	"America/La_Paz": "Bolivia",
	"America/Lima": "Peru",
	"America/Los_Angeles": "United States",
	"America/Managua": "Nicaragua",
	"America/Mexico_City": "Mexico",
	"America/Monterrey": "Mexico",
	"America/Montevideo": "Uruguay",
	// Americas
	"America/New_York": "United States",
	"America/North_Dakota/Beulah": "United States",
	"America/Panama": "Panama",
	"America/Phoenix": "United States",
	"America/Port_of_Spain": "Trinidad and Tobago",
	"America/Regina": "Canada",
	"America/Santiago": "Chile",
	"America/Sao_Paulo": "Brazil",
	"America/Toronto": "Canada",
	"America/Vancouver": "Canada",
	"America/Winnipeg": "Canada",
	"Asia/Almaty": "Kazakhstan",
	"Asia/Baghdad": "Iraq",
	"Asia/Bahrain": "Bahrain",
	"Asia/Baku": "Azerbaijan",
	"Asia/Bangkok": "Thailand",
	"Asia/Beirut": "Lebanon",
	// Asia
	"Asia/Calcutta": "India",
	"Asia/Colombo": "Sri Lanka",
	"Asia/Dhaka": "Bangladesh",
	"Asia/Dubai": "United Arab Emirates",
	"Asia/Hong_Kong": "Hong Kong",
	"Asia/Jakarta": "Indonesia",
	"Asia/Jerusalem": "Israel",
	"Asia/Karachi": "Pakistan",
	"Asia/Kathmandu": "Nepal",
	"Asia/Katmandu": "Nepal",
	"Asia/Kolkata": "India",
	"Asia/Kuala_Lumpur": "Malaysia",
	"Asia/Kuwait": "Kuwait",
	"Asia/Makassar": "Indonesia",
	"Asia/Manila": "Philippines",
	"Asia/Muscat": "Oman",
	"Asia/Nicosia": "Cyprus",
	"Asia/Phnom_Penh": "Cambodia",
	"Asia/Qatar": "Qatar",
	"Asia/Qyzylorda": "Kazakhstan",
	"Asia/Riyadh": "Saudi Arabia",
	"Asia/Saigon": "Vietnam",
	"Asia/Seoul": "South Korea",
	"Asia/Shanghai": "China",
	"Asia/Singapore": "Singapore",
	"Asia/Taipei": "Taiwan",
	"Asia/Tashkent": "Uzbekistan",
	"Asia/Tehran": "Iran",
	"Asia/Tokyo": "Japan",
	"Asia/Ulaanbaatar": "Mongolia",
	"Asia/Yekaterinburg": "Russia",
	"Asia/Yerevan": "Armenia",
	"Atlantic/Azores": "Portugal",
	"Atlantic/Canary": "Spain",
	"Atlantic/Reykjavik": "Iceland",
	"Australia/Adelaide": "Australia",
	"Australia/Brisbane": "Australia",
	"Australia/Hobart": "Australia",
	"Australia/Melbourne": "Australia",
	"Australia/Perth": "Australia",
	// Oceania
	"Australia/Sydney": "Australia",
	"Europe/Amsterdam": "Netherlands",
	"Europe/Athens": "Greece",
	"Europe/Belgrade": "Serbia",
	"Europe/Berlin": "Germany",
	"Europe/Bratislava": "Slovakia",
	"Europe/Brussels": "Belgium",
	"Europe/Bucharest": "Romania",
	"Europe/Budapest": "Hungary",
	"Europe/Copenhagen": "Denmark",
	"Europe/Dublin": "Ireland",
	"Europe/Helsinki": "Finland",
	"Europe/Istanbul": "Turkey",
	"Europe/Jerusalem": "Israel",
	"Europe/Kiev": "Ukraine",
	"Europe/Lisbon": "Portugal",
	"Europe/Ljubljana": "Slovenia",
	// Europe
	"Europe/London": "United Kingdom",
	"Europe/Luxembourg": "Luxembourg",
	"Europe/Madrid": "Spain",
	"Europe/Malta": "Malta",
	"Europe/Moscow": "Russia",
	"Europe/Nicosia": "Cyprus",
	"Europe/Oslo": "Norway",
	"Europe/Paris": "France",
	"Europe/Podgorica": "Montenegro",
	"Europe/Prague": "Czech Republic",
	"Europe/Riga": "Latvia",
	"Europe/Rome": "Italy",
	"Europe/Sarajevo": "Bosnia and Herzegovina",
	"Europe/Skopje": "North Macedonia",
	"Europe/Sofia": "Bulgaria",
	"Europe/Stockholm": "Sweden",
	"Europe/Vienna": "Austria",
	"Europe/Vilnius": "Lithuania",
	"Europe/Warsaw": "Poland",
	"Europe/Zagreb": "Croatia",
	"Europe/Zurich": "Switzerland",
	"Indian/Reunion": "Réunion",
	"Pacific/Auckland": "New Zealand",
	"Pacific/Honolulu": "United States",
}

/** A timezone's country, or Unknown when there is nothing to place. */
function countryOfTimezone(timezone: string | null | undefined): string {
	if (!timezone) return "Unknown"
	return ZONE_COUNTRY[timezone] ?? "Unknown"
}

export { countryOfTimezone, REGIONS, type RegionId, regionOfTimezone }
