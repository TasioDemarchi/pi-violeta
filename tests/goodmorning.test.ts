// The morning brief: the sentence, the three sources and the decision between
// a real headline and the joke. Every test here fixes the clock and fakes the
// network, so none of them depends on the weather or on what happened today.
import assert from "node:assert/strict";
import { test } from "node:test";
import { morningBrief, gatherFacts } from "../src/goodmorning/brief.ts";
import { buildBrief, greetingFor, numberInWords, partOfDay, timeInWords } from "../src/goodmorning/greeting.ts";
import { decodeEntities, fetchNews, fetchPlace, fetchWeather, freshest, headlineLine, parseFeed, skyFor } from "../src/goodmorning/sources.ts";

const at = (hour: number, minute = 0) => new Date(2026, 10, 3, hour, minute);

// --- The sentence ----------------------------------------------------------

test("numbers are spelled out, including the irregular twenties and a cold morning", () => {
	assert.equal(numberInWords(0), "cero");
	assert.equal(numberInWords(15), "quince");
	assert.equal(numberInWords(16), "dieciséis");
	assert.equal(numberInWords(20), "veinte");
	assert.equal(numberInWords(22), "veintidós");
	assert.equal(numberInWords(30), "treinta");
	assert.equal(numberInWords(35), "treinta y cinco");
	assert.equal(numberInWords(40), "cuarenta");
	// Spoken, so a decimal is rounded rather than read out.
	assert.equal(numberInWords(18.9), "diecinueve");
	assert.equal(numberInWords(-3), "menos tres");
});

test("the greeting follows the clock, because /goodmorn gets run at any hour", () => {
	assert.equal(greetingFor(7), "Buenos días");
	assert.equal(greetingFor(11), "Buenos días");
	assert.equal(greetingFor(12), "Buenas tardes");
	assert.equal(greetingFor(19), "Buenas tardes");
	assert.equal(greetingFor(20), "Buenas noches");
	assert.equal(greetingFor(3), "Buenas noches");
});

test("the part of the day is the phrase that follows the hour", () => {
	assert.equal(partOfDay(2), "de la madrugada");
	assert.equal(partOfDay(8), "de la mañana");
	assert.equal(partOfDay(12), "del mediodía");
	assert.equal(partOfDay(17), "de la tarde");
	assert.equal(partOfDay(22), "de la noche");
});

test("the clock is said the way a person says it", () => {
	assert.equal(timeInWords(at(17, 20)), "Son las cinco y veinte de la tarde");
	assert.equal(timeInWords(at(13, 0)), "Son la una en punto de la tarde".replace("Son la", "Es la"));
	assert.equal(timeInWords(at(7, 15)), "Son las siete y cuarto de la mañana");
	assert.equal(timeInWords(at(9, 30)), "Son las nueve y media de la mañana");
	assert.equal(timeInWords(at(0, 5)), "Son las doce y cinco de la madrugada");
});

test("the brief has every clause when every source answered", () => {
	const line = buildBrief({ name: "Tasio", now: at(7, 20), place: "Del Viso", tempC: 18.9, sky: "chaparrones", extra: "Según La Nación, llueve" });
	assert.equal(
		line,
		"Buenos días señor Tasio. Son las siete y veinte de la mañana. El clima en Del Viso es de diecinueve grados centígrados con chaparrones. Según La Nación, llueve. ¿En qué trabajaremos hoy?",
	);
});

test("a source that failed drops its own clause and nothing else", () => {
	// No weather at all: the brief must not say it has no data.
	const noWeather = buildBrief({ name: "Tasio", now: at(7, 20), extra: "algo" });
	assert.equal(noWeather, "Buenos días señor Tasio. Son las siete y veinte de la mañana. algo. ¿En qué trabajaremos hoy?");
	// Half a weather reading is not a weather reading: a temperature with no sky
	// reads like something broke, so the clause goes whole or not at all.
	assert.ok(!buildBrief({ name: "Tasio", now: at(7), tempC: 19 }).includes("grados"));
	assert.ok(!buildBrief({ name: "Tasio", now: at(7), sky: "nublado" }).includes("nublado"));
	// The city is the one piece the clause can live without.
	assert.match(buildBrief({ name: "Tasio", now: at(7), tempC: 19, sky: "nublado" }), /El clima es de diecinueve grados centígrados con nublado\./);
	// And with nothing at all it is still a greeting and a question.
	assert.equal(buildBrief({ name: "Tasio", now: at(7) }), "Buenos días señor Tasio. Son las siete en punto de la mañana. ¿En qué trabajaremos hoy?");
});

test("the day's line gets a full stop only when it is missing one", () => {
	assert.match(buildBrief({ name: "T", now: at(7), extra: "sin punto" }), /sin punto\. ¿En qué/);
	assert.match(buildBrief({ name: "T", now: at(7), extra: "con signo!" }), /con signo! ¿En qué/);
	assert.ok(!buildBrief({ name: "T", now: at(7), extra: "   " }).includes("  . "));
});

// --- The sources -----------------------------------------------------------

test("a weather code becomes words, and an unknown code is not guessed", () => {
	assert.equal(skyFor(0), "cielo despejado");
	assert.equal(skyFor(80), "chaparrones");
	assert.equal(skyFor(95), "tormenta");
	assert.equal(skyFor(7777), undefined);
	assert.equal(skyFor(undefined), undefined);
});

test("entities are decoded, because a title is read out loud", () => {
	assert.equal(decodeEntities("El &quot;no&quot; de Di&eacute;guez &amp; co &#8212; hoy"), 'El "no" de Di&eacute;guez & co — hoy');
	assert.equal(decodeEntities("&#39;basta&#39;"), "'basta'");
});

const FEED = `<?xml version="1.0"?><rss><channel>
<title>Google Noticias</title>
<item><title>Lo más nuevo - Clarín</title><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title><![CDATA[Con &amp; entidad y CDATA - La Nación]]></title><pubDate>Tue, 03 Nov 2026 09:00:00 GMT</pubDate></item>
<item><title>Sin fecha - Infobae</title></item>
<item><title>Fecha ilegible - Infobae</title><pubDate>ayer a la tarde</pubDate></item>
<item><title>Sin fuente en el titulo</title><pubDate>Tue, 03 Nov 2026 08:00:00 GMT</pubDate></item>
</channel></rss>`;

test("the feed is read for titles and dates, newest first, skipping what cannot be used", () => {
	const items = parseFeed(FEED);
	// The channel title is not an item; the two unusable items are dropped.
	assert.equal(items.length, 3);
	assert.deepEqual(
		items.map((i) => [i.title, i.source]),
		[
			["Lo más nuevo", "Clarín"],
			["Con & entidad y CDATA", "La Nación"],
			["Sin fuente en el titulo", undefined],
		],
	);
});

test("fresh means recent, and a feed dated in the future is broken rather than early", () => {
	const items = parseFeed(FEED);
	const noon = new Date("2026-11-03T12:00:00Z");
	assert.equal(freshest(items, noon)!.title, "Lo más nuevo");
	// Two days later nothing in that feed is news any more.
	assert.equal(freshest(items, new Date("2026-11-05T12:00:00Z")), undefined);
	// An hour before the newest item: it is skipped, and the next one that is
	// not in the future is taken.
	assert.equal(freshest(items, new Date("2026-11-03T09:30:00Z"))!.title, "Con & entidad y CDATA");
});

test("a headline is always attributed, so it cannot pass as something the harness knows", () => {
	assert.equal(headlineLine({ title: "Llueve", source: "Clarín", at: new Date() }), "Según Clarín, Llueve");
	assert.equal(headlineLine({ title: "Llueve", at: new Date() }), "En las noticias, Llueve");
});

/** A fetch that answers per URL, and records what was asked. */
function fakeFetch(routes: Array<[match: string, answer: () => Response | Promise<Response>]>) {
	const asked: string[] = [];
	const doFetch = (async (url: string) => {
		asked.push(String(url));
		for (const [match, answer] of routes) if (String(url).includes(match)) return await answer();
		throw new Error(`unexpected url ${url}`);
	}) as unknown as typeof fetch;
	return { doFetch, asked };
}
const ok = (body: unknown) => () => new Response(typeof body === "string" ? body : JSON.stringify(body));
const dead = () => () => {
	throw new Error("network down");
};

test("the city comes from the first service that answers one", async () => {
	const first = fakeFetch([["ifconfig.co", ok({ city: "Del Viso", latitude: -34.45, longitude: -58.79 })]]);
	assert.deepEqual(await fetchPlace(first.doFetch), { city: "Del Viso", latitude: -34.45, longitude: -58.79 });
	assert.equal(first.asked.length, 1, "the second service is not bothered when the first one answers");
});

test("the city falls through to the second service and gives up quietly", async () => {
	// The first one answers 200 with empty fields, which is how a rate-limited
	// service failed in practice: usable-looking, no data.
	const fell = fakeFetch([
		["ifconfig.co", ok({ city: null, latitude: null, longitude: null })],
		["ipwho.is", ok({ city: "Tortuguitas", lat: -34.47, lon: -58.75 })],
	]);
	assert.deepEqual(await fetchPlace(fell.doFetch), { city: "Tortuguitas", latitude: -34.47, longitude: -58.75 });
	assert.equal(fell.asked.length, 2, "it tried both");

	const both = fakeFetch([["ifconfig.co", dead()], ["ipwho.is", ok({ error: true })]]);
	assert.equal(await fetchPlace(both.doFetch), undefined);
});

test("the weather is read from the current block, and half an answer is no answer", async () => {
	const good = fakeFetch([["open-meteo", ok({ current: { temperature_2m: 18.9, weather_code: 80 } })]]);
	assert.deepEqual(await fetchWeather(-34.45, -58.79, good.doFetch), { tempC: 18.9, code: 80 });
	assert.match(good.asked[0]!, /latitude=-34\.4500&longitude=-58\.7900/);

	const partial = fakeFetch([["open-meteo", ok({ current: { temperature_2m: 18.9 } })]]);
	assert.equal(await fetchWeather(-34.45, -58.79, partial.doFetch), undefined);
	const down = fakeFetch([["open-meteo", dead()]]);
	assert.equal(await fetchWeather(-34.45, -58.79, down.doFetch), undefined);
});

test("a feed that is down is an empty list, not an exception", async () => {
	const down = fakeFetch([["news.google.com", dead()]]);
	assert.deepEqual(await fetchNews(down.doFetch), []);
	const refused = fakeFetch([["news.google.com", () => new Response("no", { status: 503 })]]);
	assert.deepEqual(await fetchNews(refused.doFetch), []);
	const good = fakeFetch([["news.google.com", ok(FEED)]]);
	assert.equal((await fetchNews(good.doFetch)).length, 3);
});

// --- The decision ----------------------------------------------------------

const PLACE = ["ifconfig.co", ok({ city: "Del Viso", latitude: -34.45, longitude: -58.79 })] as const;
const WEATHER = ["open-meteo", ok({ current: { temperature_2m: 18.9, weather_code: 80 } })] as const;

test("every fact is gathered and handed over translated", async () => {
	const net = fakeFetch([PLACE as never, WEATHER as never, ["news.google.com", ok(FEED)]]);
	const facts = await gatherFacts(new Date("2026-11-03T12:00:00Z"), net.doFetch);
	assert.deepEqual([facts.place, facts.tempC, facts.sky], ["Del Viso", 18.9, "chaparrones"]);
	assert.equal(facts.headline!.title, "Lo más nuevo");
});

test("with no city there is no weather either, and the feed is asked all the same", async () => {
	const net = fakeFetch([["ifconfig.co", dead()], ["ipwho.is", dead()], ["news.google.com", ok(FEED)]]);
	const facts = await gatherFacts(new Date("2026-11-03T12:00:00Z"), net.doFetch);
	assert.deepEqual([facts.place, facts.tempC, facts.sky], [undefined, undefined, undefined]);
	assert.ok(facts.headline, "the headline does not depend on the weather");
	assert.ok(!net.asked.some((url) => url.includes("open-meteo")), "no point asking for the weather of nowhere");
});

test("a real headline is used and the joke is never even asked for", async () => {
	const net = fakeFetch([PLACE as never, WEATHER as never, ["news.google.com", ok(FEED)]]);
	let asked = 0;
	const line = await morningBrief({
		name: "Tasio",
		now: new Date("2026-11-03T12:00:00Z"),
		doFetch: net.doFetch,
		joke: async () => {
			asked++;
			return "un chiste";
		},
	});
	assert.match(line, /Según Clarín, Lo más nuevo\./);
	assert.equal(asked, 0, "paying a model for a joke while there is news is waste");
});

test("the joke stands in only when there is nothing fresh to report", async () => {
	const stale = fakeFetch([PLACE as never, WEATHER as never, ["news.google.com", ok(FEED)]]);
	const line = await morningBrief({
		name: "Tasio",
		// Two days after the feed: everything in it is old.
		now: new Date("2026-11-05T12:00:00Z"),
		doFetch: stale.doFetch,
		joke: async () => "Hoy es jueves, el día que el lunes finge no ser",
	});
	assert.match(line, /Hoy es jueves, el día que el lunes finge no ser\./);
});

test("a joke that fails costs a clause, not the brief", async () => {
	const net = fakeFetch([PLACE as never, WEATHER as never, ["news.google.com", ok("<rss></rss>")]]);
	const line = await morningBrief({
		name: "Tasio",
		now: new Date("2026-11-03T12:00:00Z"),
		doFetch: net.doFetch,
		joke: async () => {
			throw new Error("el modelo no contestó");
		},
	});
	assert.match(line, /El clima en Del Viso/);
	assert.match(line, /¿En qué trabajaremos hoy\?$/);
	assert.ok(!line.includes("no contestó"), "an error is never read out loud");
});

test("with the network down the brief is still a greeting, the time and the question", async () => {
	const net = fakeFetch([["ifconfig.co", dead()], ["ipwho.is", dead()], ["news.google.com", dead()]]);
	const line = await morningBrief({ name: "Tasio", now: at(7, 0), doFetch: net.doFetch });
	assert.equal(line, "Buenos días señor Tasio. Son las siete en punto de la mañana. ¿En qué trabajaremos hoy?");
});
