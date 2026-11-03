// The morning brief: the sentence, the three sources and the decision between
// a real headline and the joke. Every test here fixes the clock and fakes the
// network, so none of them depends on the weather or on what happened today.
import assert from "node:assert/strict";
import { test } from "node:test";
import { morningBrief, gatherFacts } from "../src/goodmorning/brief.ts";
import { buildBrief, forTheEar, greetingFor, numberInWords, partOfDay, timeInWords } from "../src/goodmorning/greeting.ts";
import {
	decodeEntities,
	fetchNews,
	fetchPlace,
	fetchWeather,
	freshStories,
	freshest,
	headlineLine,
	parseFeed,
	relatedTitles,
	skyFor,
} from "../src/goodmorning/sources.ts";

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
		"Buenos días Tasio. Son las siete y veinte de la mañana. El clima en Del Viso es de diecinueve grados con chaparrones. Según La Nación, llueve. ¿En qué trabajaremos hoy?",
	);
});

test("a source that failed drops its own clause and nothing else", () => {
	// No weather at all: the brief must not say it has no data.
	const noWeather = buildBrief({ name: "Tasio", now: at(7, 20), extra: "algo" });
	assert.equal(noWeather, "Buenos días Tasio. Son las siete y veinte de la mañana. algo. ¿En qué trabajaremos hoy?");
	// Half a weather reading is not a weather reading: a temperature with no sky
	// reads like something broke, so the clause goes whole or not at all.
	assert.ok(!buildBrief({ name: "Tasio", now: at(7), tempC: 19 }).includes("grados"));
	assert.ok(!buildBrief({ name: "Tasio", now: at(7), sky: "nublado" }).includes("nublado"));
	// The city is the one piece the clause can live without.
	assert.match(buildBrief({ name: "Tasio", now: at(7), tempC: 19, sky: "nublado" }), /El clima es de diecinueve grados con nublado\./);
	// And with nothing at all it is still a greeting and a question.
	assert.equal(buildBrief({ name: "Tasio", now: at(7) }), "Buenos días Tasio. Son las siete en punto de la mañana. ¿En qué trabajaremos hoy?");
});

test("the symbols a headline is written with become the words it is said with", () => {
	// Money first and in order: the dollar forms contain the peso sign, and in
	// Argentina a bare $ is pesos.
	assert.equal(forTheEar("la RTX 5090 aumentó USD $500."), "la RTX 5090 aumentó 500 dólares.");
	assert.equal(forTheEar("sale a u$s399 en diciembre"), "sale a 399 dólares en diciembre");
	assert.equal(forTheEar("el dólar llegó a $1.480"), "el dólar llegó a 1.480 pesos");
	assert.equal(forTheEar("subió 3,5%"), "subió 3,5 por ciento");
	assert.equal(forTheEar("vendió un 20 % más"), "vendió un 20 por ciento más");
	assert.equal(forTheEar("rinde a 85 °C"), "rinde a 85 grados");
	// A product name is not a number to spell out: a model asked to do this in
	// prose turned "RTX 5090" into "el modelo cinco mil noventa".
	assert.equal(forTheEar("las RTX 50 y la RTX 5090"), "las RTX 50 y la RTX 5090");
	assert.equal(forTheEar("una frase sin símbolos"), "una frase sin símbolos");
	// The number must end in a digit, or it eats the sentence's full stop.
	assert.ok(!forTheEar("costó USD $500.").includes(". dólares"));
});

test("the day's line is made sayable on its way into the brief", () => {
	assert.match(buildBrief({ name: "T", now: at(7), extra: "Hoy la placa sale a US$ 600" }), /sale a 600 dólares\./);
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

test("the fallback line opens with Hoy and names no outlet", () => {
	// The owner's call: the brief says what happened, not who reported it.
	assert.equal(headlineLine({ title: "Llueve en todo el país", source: "Clarín", at: new Date(), related: [] }), "Hoy, Llueve en todo el país");
});

test("the other outlets' headlines are pulled out of the description, and the story's own is not one of them", () => {
	const description =
		"&lt;ol&gt;&lt;li&gt;&lt;a href=\"x\"&gt;El titular principal&lt;/a&gt;&amp;nbsp;&lt;font color=\"#6f6f6f\"&gt;Clarín&lt;/font&gt;&lt;/li&gt;" +
		"&lt;li&gt;&lt;a href=\"y\"&gt;Otro diario lo cuenta así&lt;/a&gt;&lt;font&gt;La Nación&lt;/font&gt;&lt;/li&gt;&lt;/ol&gt;";
	// The outlet names sit in a <font> and go with the rest of the markup.
	assert.deepEqual(relatedTitles(description), ["El titular principal", "Otro diario lo cuenta así"]);
	assert.deepEqual(relatedTitles(undefined), []);

	const item = parseFeed(
		`<rss><channel><item><title>El titular principal - Clarín</title><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate><description>${description}</description></item></channel></rss>`,
	)[0]!;
	assert.deepEqual(item.related, ["Otro diario lo cuenta así"], "the item's own headline is not related to itself");
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

test("one feed per topic, each with its own quota, and a story that matches two is kept once", async () => {
	// A single OR query is dominated by whichever topic published most in the
	// last hour, so each topic is asked separately and keeps its own slots.
	const item = (title: string, minute: number) =>
		`<item><title>${title}</title><pubDate>Tue, 03 Nov 2026 10:${String(minute).padStart(2, "0")}:00 GMT</pubDate></item>`;
	const feed = (...items: string[]) => `<rss><channel>${items.join("")}</channel></rss>`;
	const net = fakeFetch([
		// Five stories, one over the per-topic quota.
		["inteligencia", ok(feed(item("IA uno", 50), item("IA dos", 40), item("IA tres", 30), item("IA cuatro", 20), item("IA cinco", 10)))],
		// The same story as the AI feed's newest: it matched both queries.
		["Nvidia", ok(feed(item("IA uno", 50), item("Una placa nueva", 45)))],
		["PlayStation", ok(feed(item("Un juego", 35)))],
	]);
	const stories = await fetchNews(net.doFetch);
	assert.equal(net.asked.length, 3, "one request per topic");
	assert.deepEqual(
		stories.map((story) => story.title),
		["IA uno", "Una placa nueva", "IA dos", "Un juego", "IA tres", "IA cuatro"],
		"newest first, four per topic at most, and no title twice",
	);
	assert.ok(!stories.some((story) => story.title === "IA cinco"), "the fifth story of a topic is over its quota");
});

test("a topic whose feed is down costs that topic, not the news", async () => {
	const net = fakeFetch([
		["inteligencia", dead()],
		["Nvidia", () => new Response("no", { status: 503 })],
		["PlayStation", ok(FEED)],
	]);
	const stories = await fetchNews(net.doFetch);
	assert.equal(stories.length, 3, "the one feed that answered is still the news");
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
	assert.deepEqual(
		facts.stories.map((story) => story.title),
		["Lo más nuevo", "Con & entidad y CDATA", "Sin fuente en el titulo"],
		"every fresh story is handed over, newest first, for the choice to be made on",
	);
});

test("with no city there is no weather either, and the feed is asked all the same", async () => {
	const net = fakeFetch([["ifconfig.co", dead()], ["ipwho.is", dead()], ["news.google.com", ok(FEED)]]);
	const facts = await gatherFacts(new Date("2026-11-03T12:00:00Z"), net.doFetch);
	assert.deepEqual([facts.place, facts.tempC, facts.sky], [undefined, undefined, undefined]);
	assert.ok(facts.stories.length > 0, "the news does not depend on the weather");
	assert.ok(!net.asked.some((url) => url.includes("open-meteo")), "no point asking for the weather of nowhere");
});

test("every fresh story is offered for the choice, summarized, and the joke is never even asked for", async () => {
	const net = fakeFetch([PLACE as never, WEATHER as never, ["news.google.com", ok(FEED)]]);
	let asked = 0;
	let given: string[] = [];
	const { text: line } = await morningBrief({
		name: "Tasio",
		now: new Date("2026-11-03T12:00:00Z"),
		doFetch: net.doFetch,
		summarize: async (stories) => {
			given = stories.map((story) => story.title);
			return "Hoy el país amaneció sin novedades";
		},
		joke: async () => {
			asked++;
			return "un chiste";
		},
	});
	assert.match(line, /Hoy el país amaneció sin novedades\./);
	assert.ok(!line.includes("Lo más nuevo"), "the headline itself is not read when there is a sentence for it");
	// The whole fresh set, not just the newest: picking the one that matters
	// here is impossible with one story to choose from.
	assert.deepEqual(given, ["Lo más nuevo", "Con & entidad y CDATA", "Sin fuente en el titulo"]);
	assert.equal(asked, 0, "paying a model for a joke while there is news is waste");
});

test("the candidate set is the fresh ones, newest first, and no more than asked for", () => {
	const items = parseFeed(FEED);
	const noon = new Date("2026-11-03T12:00:00Z");
	assert.deepEqual(
		freshStories(items, noon).map((story) => story.title),
		["Lo más nuevo", "Con & entidad y CDATA", "Sin fuente en el titulo"],
	);
	assert.equal(freshStories(items, noon, 2).length, 2, "the cap keeps the prompt one cheap call");
	assert.deepEqual(freshStories(items, new Date("2026-11-05T12:00:00Z")), [], "nothing fresh is an empty set, not the old ones");
	// The unjudged fallback is still the newest of that same set.
	assert.equal(freshest(items, noon)!.title, "Lo más nuevo");
});

test("a summary that fails falls back to the headline, not to the joke", async () => {
	const net = fakeFetch([PLACE as never, WEATHER as never, ["news.google.com", ok(FEED)]]);
	let jokes = 0;
	const { text: line } = await morningBrief({
		name: "Tasio",
		now: new Date("2026-11-03T12:00:00Z"),
		doFetch: net.doFetch,
		summarize: async () => {
			throw new Error("el modelo no contestó");
		},
		joke: async () => {
			jokes++;
			return "un chiste";
		},
	});
	assert.match(line, /Hoy, Lo más nuevo\./, "there is real news, so it is reported however it reads");
	assert.equal(jokes, 0, "a joke is for a day with no news, not for a day the model misbehaved");
	assert.ok(!line.includes("no contestó"));
});

test("an empty summary is treated as no summary", async () => {
	const net = fakeFetch([PLACE as never, WEATHER as never, ["news.google.com", ok(FEED)]]);
	const { text: line } = await morningBrief({
		name: "Tasio",
		now: new Date("2026-11-03T12:00:00Z"),
		doFetch: net.doFetch,
		summarize: async () => "   ",
	});
	assert.match(line, /Hoy, Lo más nuevo\./);
});

test("the joke stands in only when there is nothing fresh to report", async () => {
	const stale = fakeFetch([PLACE as never, WEATHER as never, ["news.google.com", ok(FEED)]]);
	const { text: line } = await morningBrief({
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
	const { text: line } = await morningBrief({
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
	const { text: line } = await morningBrief({ name: "Tasio", now: at(7, 0), doFetch: net.doFetch });
	assert.equal(line, "Buenos días Tasio. Son las siete en punto de la mañana. ¿En qué trabajaremos hoy?");
});
