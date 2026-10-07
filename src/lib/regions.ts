/**
 * Where "region" means on the admin overview: a coarse bucket derived from each account's IANA timezone (`User.timezone`).
 *
 * This is the only per-user geography with real coverage (shop regions are pricing prefs almost nobody picks; the HCA address country is encrypted PII held for one account). Buckets follow IANA areas rather than a curated country list, so there is nothing to maintain as signups spread – and nothing to mislabel. `other` is valid-but-placeless zones (Etc, GMT, the POSIX-style ones); `unknown` is no timezone on file.
 */
export type RegionId = "americas" | "europe" | "asia" | "africa" | "oceania" | "other" | "unknown"

export const REGIONS: { id: RegionId; label: string }[] = [
	{ id: "americas", label: "Americas" },
	{ id: "europe", label: "Europe" },
	{ id: "asia", label: "Asia" },
	{ id: "africa", label: "Africa" },
	{ id: "oceania", label: "Oceania" },
	{ id: "other", label: "Other" },
	{ id: "unknown", label: "Unknown" },
]

export function regionOfTimezone(timezone: string | null | undefined): RegionId {
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
		default:
			return "other"
	}
}

/**
 * IANA zone to country, for the country breakdown. Covers every timezone on file plus the common aliases browsers report (e.g. both Kathmandu spellings); anything else falls to Unknown so a new zone shows up as unplaced rather than mislabeled – extend the map when it does.
 */
const ZONE_COUNTRY: Record<string, string> = {
	// Americas
	"America/New_York": "United States",
	"America/Chicago": "United States",
	"America/Los_Angeles": "United States",
	"America/Denver": "United States",
	"America/Phoenix": "United States",
	"America/Indianapolis": "United States",
	"America/Detroit": "United States",
	"America/Boise": "United States",
	"America/Anchorage": "United States",
	"Pacific/Honolulu": "United States",
	"America/Toronto": "Canada",
	"America/Vancouver": "Canada",
	"America/Edmonton": "Canada",
	"America/Winnipeg": "Canada",
	"America/Halifax": "Canada",
	"America/Regina": "Canada",
	"America/Mexico_City": "Mexico",
	"America/Monterrey": "Mexico",
	"America/Bogota": "Colombia",
	"America/Lima": "Peru",
	"America/Sao_Paulo": "Brazil",
	"America/Fortaleza": "Brazil",
	"America/Montevideo": "Uruguay",
	"America/Santiago": "Chile",
	"America/Buenos_Aires": "Argentina",
	"America/Argentina/Buenos_Aires": "Argentina",
	"America/Jujuy": "Argentina",
	"America/Caracas": "Venezuela",
	"America/La_Paz": "Bolivia",
	"America/Guayaquil": "Ecuador",
	"America/Guatemala": "Guatemala",
	"America/Costa_Rica": "Costa Rica",
	"America/Managua": "Nicaragua",
	"America/Panama": "Panama",
	"America/Dominica": "Dominica",
	"America/Jamaica": "Jamaica",
	"America/Port_of_Spain": "Trinidad and Tobago",
	"America/North_Dakota/Beulah": "United States",
	// Europe
	"Europe/London": "United Kingdom",
	"Europe/Berlin": "Germany",
	"Europe/Rome": "Italy",
	"Europe/Prague": "Czech Republic",
	"Europe/Bucharest": "Romania",
	"Europe/Istanbul": "Turkey",
	"Europe/Paris": "France",
	"Europe/Warsaw": "Poland",
	"Europe/Madrid": "Spain",
	"Atlantic/Canary": "Spain",
	"Europe/Amsterdam": "Netherlands",
	"Europe/Stockholm": "Sweden",
	"Europe/Zurich": "Switzerland",
	"Europe/Athens": "Greece",
	"Europe/Brussels": "Belgium",
	"Europe/Sofia": "Bulgaria",
	"Europe/Bratislava": "Slovakia",
	"Europe/Lisbon": "Portugal",
	"Atlantic/Azores": "Portugal",
	"Europe/Dublin": "Ireland",
	"Europe/Budapest": "Hungary",
	"Europe/Vienna": "Austria",
	"Europe/Copenhagen": "Denmark",
	"Europe/Helsinki": "Finland",
	"Europe/Belgrade": "Serbia",
	"Europe/Oslo": "Norway",
	"Europe/Ljubljana": "Slovenia",
	"Europe/Moscow": "Russia",
	"Asia/Yekaterinburg": "Russia",
	"Europe/Luxembourg": "Luxembourg",
	"Europe/Malta": "Malta",
	"Europe/Kiev": "Ukraine",
	"Europe/Podgorica": "Montenegro",
	"Europe/Zagreb": "Croatia",
	"Europe/Skopje": "North Macedonia",
	"Europe/Sarajevo": "Bosnia and Herzegovina",
	"Europe/Riga": "Latvia",
	"Europe/Vilnius": "Lithuania",
	"Europe/Jerusalem": "Israel",
	"Asia/Jerusalem": "Israel",
	"Europe/Nicosia": "Cyprus",
	"Asia/Nicosia": "Cyprus",
	"Atlantic/Reykjavik": "Iceland",
	// Asia
	"Asia/Calcutta": "India",
	"Asia/Kolkata": "India",
	"Asia/Dubai": "United Arab Emirates",
	"Asia/Katmandu": "Nepal",
	"Asia/Kathmandu": "Nepal",
	"Asia/Karachi": "Pakistan",
	"Asia/Dhaka": "Bangladesh",
	"Asia/Singapore": "Singapore",
	"Asia/Kuala_Lumpur": "Malaysia",
	"Asia/Riyadh": "Saudi Arabia",
	"Asia/Bangkok": "Thailand",
	"Asia/Shanghai": "China",
	"Asia/Tashkent": "Uzbekistan",
	"Asia/Hong_Kong": "Hong Kong",
	"Asia/Jakarta": "Indonesia",
	"Asia/Makassar": "Indonesia",
	"Asia/Taipei": "Taiwan",
	"Asia/Seoul": "South Korea",
	"Asia/Manila": "Philippines",
	"Asia/Tokyo": "Japan",
	"Asia/Almaty": "Kazakhstan",
	"Asia/Qyzylorda": "Kazakhstan",
	"Asia/Kuwait": "Kuwait",
	"Asia/Qatar": "Qatar",
	"Asia/Muscat": "Oman",
	"Asia/Baghdad": "Iraq",
	"Asia/Tehran": "Iran",
	"Asia/Ulaanbaatar": "Mongolia",
	"Asia/Bahrain": "Bahrain",
	"Asia/Beirut": "Lebanon",
	"Asia/Phnom_Penh": "Cambodia",
	"Asia/Saigon": "Vietnam",
	"Asia/Yerevan": "Armenia",
	"Asia/Baku": "Azerbaijan",
	"Asia/Colombo": "Sri Lanka",
	// Africa
	"Africa/Cairo": "Egypt",
	"Africa/Casablanca": "Morocco",
	"Africa/Lagos": "Nigeria",
	"Africa/Johannesburg": "South Africa",
	"Africa/Tunis": "Tunisia",
	"Africa/Nairobi": "Kenya",
	"Africa/Kampala": "Uganda",
	"Africa/Algiers": "Algeria",
	"Africa/Douala": "Cameroon",
	"Africa/Harare": "Zimbabwe",
	"Africa/Kigali": "Rwanda",
	"Africa/Accra": "Ghana",
	"Africa/Blantyre": "Malawi",
	"Africa/Dar_es_Salaam": "Tanzania",
	"Africa/Addis_Ababa": "Ethiopia",
	"Africa/Windhoek": "Namibia",
	"Africa/Lusaka": "Zambia",
	"Africa/Mbabane": "Eswatini",
	// Oceania
	"Australia/Sydney": "Australia",
	"Australia/Brisbane": "Australia",
	"Australia/Perth": "Australia",
	"Australia/Melbourne": "Australia",
	"Australia/Adelaide": "Australia",
	"Australia/Hobart": "Australia",
	"Pacific/Auckland": "New Zealand",
	"Indian/Reunion": "Réunion",
}

/** A timezone's country, or Unknown when there is nothing to place. */
export function countryOfTimezone(timezone: string | null | undefined): string {
	if (!timezone) return "Unknown"
	return ZONE_COUNTRY[timezone] ?? "Unknown"
}
