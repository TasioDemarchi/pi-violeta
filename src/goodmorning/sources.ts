/**
 * goodmorning-sources — where the brief's facts come from.
 *
 * Three public services, none of which needs an account or a key:
 *
 * - the city, from the IP (ifconfig.co, then ipwho.is as a second try);
 * - the weather, from Open-Meteo, which answers with a WMO code;
 * - the headlines, from Google News' RSS feed for Argentina.
 *
 * Every fetch here answers `undefined` instead of throwing: the brief is a
 * nicety, and a service being down must cost a clause, never the greeting.
 * `fetch` is a parameter so the tests exercise the parsing without a network,
 * the same way src/voice/nan.ts does it.
 *
 * Parsing the feed with a regular expression rather than an XML library is
 * deliberate: the only fields needed are the title and the date of each item,
 * and a dependency for that is one more thing to keep working.
 */

/** Long enough to survive a slow morning, short enough that a hung service
 * does not hold the greeting. */
const TIMEOUT_MS = 8000;
/** A headline older than this is not news any more, and the day's line falls
 * back to the joke. */
export const NEWS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type Fetch = typeof fetch;

/** WMO weather codes, as Open-Meteo documents them, in the words a person
 * would use out loud. An unknown code is not guessed. */
const SKY: Record<number, string> = {
	0: "cielo despejado",
	1: "cielo mayormente despejado",
	2: "cielo parcialmente nublado",
	3: "cielo nublado",
	45: "niebla",
	48: "niebla con escarcha",
	51: "llovizna leve",
	53: "llovizna",
	55: "llovizna intensa",
	56: "llovizna helada",
	57: "llovizna helada intensa",
	61: "lluvia leve",
	63: "lluvia",
	65: "lluvia intensa",
	66: "lluvia helada",
	67: "lluvia helada intensa",
	71: "nevada leve",
	73: "nevada",
	75: "nevada intensa",
	77: "granos de nieve",
	80: "chaparrones",
	81: "chaparrones fuertes",
	82: "chaparrones violentos",
	85: "chaparrones de nieve",
	86: "chaparrones de nieve intensos",
	95: "tormenta",
	96: "tormenta con granizo",
	99: "tormenta con granizo fuerte",
};

export function skyFor(code: number | undefined): string | undefined {
	return code === undefined ? undefined : SKY[code];
}

export interface Place {
	city: string;
	latitude: number;
	longitude: number;
}

const isPlace = (value: unknown): value is Place => {
	const p = value as Partial<Place> | null;
	return !!p && typeof p.city === "string" && p.city !== "" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
};

/** Both services answer the same three fields under different names, so one
 * reader covers them. */
function readPlace(body: unknown): Place | undefined {
	const raw = body as Record<string, unknown> | null;
	if (!raw) return undefined;
	const candidate = {
		city: raw.city,
		latitude: raw.latitude ?? raw.lat,
		longitude: raw.longitude ?? raw.lon,
	};
	return isPlace(candidate) ? candidate : undefined;
}

async function json(url: string, doFetch: Fetch): Promise<unknown> {
	const response = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return await response.json();
}

/** The city the IP resolves to, with its coordinates for the weather call.
 * Two services because this is the only link the rest depends on: with no
 * coordinates there is no weather either. */
export async function fetchPlace(doFetch: Fetch = fetch): Promise<Place | undefined> {
	for (const url of ["https://ifconfig.co/json", "https://ipwho.is/"]) {
		try {
			const place = readPlace(await json(url, doFetch));
			if (place) return place;
		} catch {
			// try the next one
		}
	}
	return undefined;
}

export interface Weather {
	tempC: number;
	code: number;
}

export async function fetchWeather(latitude: number, longitude: number, doFetch: Fetch = fetch): Promise<Weather | undefined> {
	const url =
		"https://api.open-meteo.com/v1/forecast" +
		`?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
		"&current=temperature_2m,weather_code";
	try {
		const current = (await json(url, doFetch)) as { current?: { temperature_2m?: unknown; weather_code?: unknown } };
		const tempC = current?.current?.temperature_2m;
		const code = current?.current?.weather_code;
		if (!Number.isFinite(tempC) || !Number.isFinite(code)) return undefined;
		return { tempC: tempC as number, code: code as number };
	} catch {
		return undefined;
	}
}

export interface Headline {
	title: string;
	/** The outlet, which Google News appends to the title after " - ". */
	source?: string;
	at: Date;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Entities have to go: a title is read aloud, and "&quot;" is not a word. */
export function decodeEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

const tag = (item: string, name: string): string | undefined => {
	const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(item);
	if (!match) return undefined;
	const inner = match[1]!.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1");
	const text = decodeEntities(inner).replace(/\s+/g, " ").trim();
	return text === "" ? undefined : text;
};

/** Every item in the feed that has a title and a usable date, newest first.
 * An item missing either is skipped rather than guessed at. */
export function parseFeed(xml: string): Headline[] {
	const items: Headline[] = [];
	for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
		const title = tag(body!, "title");
		const published = tag(body!, "pubDate");
		if (!title || !published) continue;
		const at = new Date(published);
		if (Number.isNaN(at.getTime())) continue;
		// Google News appends the outlet to the title; the last dash is the one.
		const split = /^(.*) - ([^-]+)$/.exec(title);
		items.push({ title: split ? split[1]!.trim() : title, source: split ? split[2]!.trim() : undefined, at });
	}
	return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The newest headline that is still news, or nothing. */
export function freshest(items: readonly Headline[], now: Date, maxAgeMs: number = NEWS_MAX_AGE_MS): Headline | undefined {
	return items.find((item) => {
		const age = now.getTime() - item.at.getTime();
		// A date in the future is a broken feed, not tomorrow's news.
		return age >= 0 && age <= maxAgeMs;
	});
}

/** The headline as it is said: attributed, so it is never mistaken for
 * something the harness knows by itself. */
export function headlineLine(item: Headline): string {
	return item.source ? `Según ${item.source}, ${item.title}` : `En las noticias, ${item.title}`;
}

export async function fetchNews(doFetch: Fetch = fetch): Promise<Headline[]> {
	try {
		const response = await doFetch("https://news.google.com/rss?hl=es-419&gl=AR&ceid=AR:es-419", {
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) return [];
		return parseFeed(await response.text());
	} catch {
		return [];
	}
}
