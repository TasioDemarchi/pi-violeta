/**
 * goodmorning-sources — where the brief's facts come from.
 *
 * Three public services, none of which needs an account or a key:
 *
 * - the city, from the IP (ifconfig.co, then ipwho.is as a second try);
 * - the weather, from Open-Meteo, which answers with a WMO code;
 * - the headlines, from one Google News search feed per topic the owner
 *   cares about. The general feed was dropped: its top story is the dollar,
 *   an accident or a football match, and the brief is for one person.
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

import { getLanguage, goodmorning as gm } from "../i18n.ts";

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
	/** The outlet, which Google News appends to the title after " - ". It is
	 * parsed to be stripped off the title, not to be read out: the brief says
	 * what happened, not who reported it. */
	source?: string;
	at: Date;
	/** The other outlets' headlines about the same story, which Google News
	 * puts in the item's description. Real material, and the only way a one
	 * line summary can be about the story rather than about one phrasing. */
	related: string[];
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

/** The headlines inside an item's description: Google News puts a list of the
 * other outlets covering the same story there, as escaped HTML. Only the link
 * texts are kept, which are the headlines; the outlet names sit in a <font>
 * and are dropped with the rest of the markup. */
export function relatedTitles(description: string | undefined): string[] {
	if (!description) return [];
	const html = decodeEntities(description);
	const titles: string[] = [];
	for (const [, text] of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
		const clean = decodeEntities(text!.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
		if (clean !== "" && !titles.includes(clean)) titles.push(clean);
	}
	return titles;
}

/** The raw text of a tag, CDATA unwrapped but markup left alone. */
const tagRaw = (item: string, name: string): string | undefined => {
	const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(item);
	if (!match) return undefined;
	return match[1]!.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1");
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
		const bare = split ? split[1]!.trim() : title;
		// The main headline is in the related list too; it is not "related".
		const related = relatedTitles(tagRaw(body!, "description")).filter((other) => other !== bare);
		items.push({ title: bare, source: split ? split[2]!.trim() : undefined, at, related });
	}
	return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Words and characters that no English headline carries and that almost
 * every Spanish one does. Ambiguous short words that are also English words
 * ("son", "al", "ya", "no") are deliberately left out: a false positive would
 * let an English headline through, which is the whole thing being prevented. */
const SPANISH_MARKERS =
	/[ñáéíóúü¿¡]|\b(?:de|del|la|el|los|las|un|una|unos|unas|que|para|con|por|más|pero|como|tras|sobre|sin|hasta|desde|su|sus|este|esta|estos|estas|ser|hacer|tiene|llega|lanza)\b/i;

/** Whether a headline is in the language the brief speaks.
 *
 * The feed is asked in Spanish for Argentina and still answers with English
 * headlines about AI and hardware, which the brief then read aloud in the
 * middle of a Spanish sentence. A story the brief cannot say in its own
 * language is not a candidate: it is dropped before the model ever sees it,
 * so neither the summary nor the headline fallback can be foreign. */
export function fitsBriefLanguage(title: string): boolean {
	const spanish = SPANISH_MARKERS.test(title);
	return getLanguage() === "es" ? spanish : !spanish;
}

/** How many stories are offered for the one that matters here to be picked
 * out of. Enough for a real choice, few enough to stay one cheap prompt. */
export const NEWS_CANDIDATES = 8;

/** Every story that is still news, newest first. */
export function freshStories(
	items: readonly Headline[],
	now: Date,
	max: number = NEWS_CANDIDATES,
	maxAgeMs: number = NEWS_MAX_AGE_MS,
): Headline[] {
	return items
		.filter((item) => {
			const age = now.getTime() - item.at.getTime();
			// A date in the future is a broken feed, not tomorrow's news.
			return age >= 0 && age <= maxAgeMs;
		})
		.slice(0, max);
}

/** The newest headline that is still news, or nothing. It is what the brief
 * says when no model is there to choose, so it is the feed's own order
 * rather than a judgement about what matters here. */
export function freshest(items: readonly Headline[], now: Date, maxAgeMs: number = NEWS_MAX_AGE_MS): Headline | undefined {
	return freshStories(items, now, 1, maxAgeMs)[0];
}

/** The day's line when no model turned the story into a sentence: the headline
 * itself, without the outlet, opening the way the owner asked for. A headline
 * is written to be read, so this is the worse of the two and only a fallback. */
export function headlineLine(item: Headline): string {
	return `${gm.opener}, ${item.title}`;
}

/** What the owner wants to hear about. One query per topic, because a single
 * OR query is dominated by whichever topic published most in the last hour:
 * four hardware leaks would bury the only AI story of the day. Changing these
 * three lines changes what the brief is about. */
export const NEWS_TOPICS: readonly { name: string; query: string }[] = [
	{ name: "ia", query: '"inteligencia artificial" OR "modelos de lenguaje" OR OpenAI OR Anthropic' },
	{ name: "hardware", query: '"placas de video" OR "tarjetas gráficas" OR "hardware gaming" OR Nvidia OR "AMD Radeon"' },
	{ name: "videojuegos", query: "videojuegos OR PlayStation OR Nintendo OR Steam" },
];

/** Stories kept per topic, so each one is represented in the choice. */
export const NEWS_PER_TOPIC = 4;

const searchUrl = (query: string) => `https://news.google.com/rss/search?hl=es-419&gl=AR&ceid=AR:es-419&q=${encodeURIComponent(query)}`;

/** Every topic's feed, newest first, with one entry per story. A story that
 * matches two topics comes back twice, and the same title read twice would be
 * two chances at the same news, so titles are kept unique. */
export async function fetchNews(doFetch: Fetch = fetch): Promise<Headline[]> {
	const perTopic = await Promise.all(
		NEWS_TOPICS.map(async (topic) => {
			try {
				const response = await doFetch(searchUrl(topic.query), { signal: AbortSignal.timeout(TIMEOUT_MS) });
				if (!response.ok) return [];
				return parseFeed(await response.text()).slice(0, NEWS_PER_TOPIC);
			} catch {
				// One topic being down costs that topic, not the news.
				return [];
			}
		}),
	);
	const seen = new Set<string>();
	const stories: Headline[] = [];
	for (const story of perTopic.flat().sort((a, b) => b.at.getTime() - a.at.getTime())) {
		if (seen.has(story.title)) continue;
		seen.add(story.title);
		stories.push(story);
	}
	return stories;
}
