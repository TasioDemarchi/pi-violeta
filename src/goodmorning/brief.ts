/**
 * goodmorning-brief — gathers the facts and decides what the day's line is.
 *
 * The decision lives here, not in the extension, so it can be tested: a fresh
 * headline is used and attributed; only when there is none (an empty feed, a
 * feed that is down, nothing newer than NEWS_MAX_AGE_MS) does the joke stand
 * in for it. The joke is a function the caller supplies, because it is the one
 * piece that needs a model, and it is never asked for when there is real news
 * to report.
 */

import { briefSentences } from "./greeting.ts";
import { type Fetch, type Headline, fetchNews, fetchPlace, fetchWeather, freshStories, headlineLine, skyFor } from "./sources.ts";

export interface Choice {
	/** The sentence to say. */
	line: string;
	/** Which story it is about, 1-based as the prompt numbers them, when the
	 * answer said so. */
	index?: number;
}

/** The model answers "3. Hoy ...", so the brief knows which story it told and
 * can keep from telling it again. An answer with no number is still a usable
 * sentence -- it just cannot be remembered -- and a number out of range is
 * treated as no number at all. */
export function parseChoice(text: string, count: number): Choice | undefined {
	const trimmed = text.trim();
	if (trimmed === "") return undefined;
	const match = /^(\d{1,2})\s*[.:)\u2013-]\s*(.+)$/s.exec(trimmed);
	if (!match) return { line: trimmed };
	const index = Number(match[1]);
	const line = match[2]!.trim();
	if (line === "") return { line: trimmed };
	return index >= 1 && index <= count ? { line, index } : { line };
}

export interface GatheredFacts {
	place?: string;
	tempC?: number;
	sky?: string;
	/** Every story still fresh, newest first: the choice of which one matters
	 * here is a judgement, so it is not made while gathering. */
	stories: Headline[];
}

/** The three lookups, with the two independent ones in flight together. The
 * weather needs coordinates, so it waits for the city; the feed does not. */
export async function gatherFacts(now: Date, doFetch: Fetch = fetch, alreadySaid: readonly string[] = []): Promise<GatheredFacts> {
	const news = fetchNews(doFetch);
	const place = await fetchPlace(doFetch);
	const weather = place ? await fetchWeather(place.latitude, place.longitude, doFetch) : undefined;
	// Told stories go before the cap, not after: otherwise five already-heard
	// ones would fill the eight slots and crowd out what is new.
	const told = new Set(alreadySaid);
	return {
		place: place?.city,
		tempC: weather?.tempC,
		sky: skyFor(weather?.code),
		stories: freshStories((await news).filter((story) => !told.has(story.title)), now),
	};
}

export interface BriefRequest {
	name: string;
	now: Date;
	doFetch?: Fetch;
	/** Picks the story that matters here and turns it into one plain sentence.
	 * Given every fresh story with the other outlets' headlines about each, so
	 * both the choice and the sentence are made on the stories themselves.
	 * Answering nothing falls back to the newest headline, unjudged. */
	summarize?: (stories: readonly Headline[]) => Promise<Choice | undefined>;
	/** Titles the brief has already told. They are dropped from the candidates,
	 * so a second session in the same hour gets different news or, once there is
	 * none left, the joke. */
	alreadySaid?: readonly string[];
	/** Asked for a line only when no fresh headline exists. May answer nothing,
	 * in which case the brief simply has no day's line. */
	joke?: () => Promise<string | undefined>;
}

/** The choice, or nothing when there is no summarizer or it failed. */
async function summarized(request: BriefRequest, stories: readonly Headline[]): Promise<Choice | undefined> {
	if (!request.summarize) return undefined;
	try {
		const choice = await request.summarize(stories);
		if (!choice || choice.line.trim() === "") return undefined;
		return { line: choice.line.trim(), index: choice.index };
	} catch {
		return undefined;
	}
}

export interface Brief {
	/** One line, for the screen. */
	text: string;
	/** The title of the story that was told, when it is known: the caller
	 * remembers it so the next session gets different news. */
	saidTitle?: string;
	/** The same thing in pieces, for the voice: one synthesis per sentence, so
	 * the pause between them is measured rather than guessed. */
	sentences: string[];
}

/** The whole brief, in both of the forms it is used in. */
export async function morningBrief(request: BriefRequest): Promise<Brief> {
	const facts = await gatherFacts(request.now, request.doFetch ?? fetch, request.alreadySaid ?? []);
	let extra: string | undefined;
	let said: string | undefined;
	const newest = facts.stories[0];
	if (newest) {
		// A headline is written to be read, not heard: it carries a colon, a
		// subtitle and the words "EN VIVO". The sentence is what makes it
		// speakable, and the newest headline is the fallback when there is none.
		const choice = await summarized(request, facts.stories);
		extra = choice?.line ?? headlineLine(newest);
		// Only a story that can be named is remembered. Without a number the
		// sentence is still said; it may just come up again tomorrow.
		said = choice ? (choice.index ? facts.stories[choice.index - 1]?.title : undefined) : newest.title;
	} else if (request.joke) {
		try {
			extra = await request.joke();
		} catch {
			// A failed joke is not worth a word: the brief goes out without it.
			extra = undefined;
		}
	}
	const sentences = briefSentences({ name: request.name, now: request.now, place: facts.place, tempC: facts.tempC, sky: facts.sky, extra });
	return { text: sentences.join(" "), sentences, saidTitle: said };
}
