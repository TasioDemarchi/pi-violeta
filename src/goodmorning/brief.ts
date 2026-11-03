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

import { buildBrief } from "./greeting.ts";
import { type Fetch, type Headline, fetchNews, fetchPlace, fetchWeather, freshest, headlineLine, skyFor } from "./sources.ts";

export interface GatheredFacts {
	place?: string;
	tempC?: number;
	sky?: string;
	headline?: Headline;
}

/** The three lookups, with the two independent ones in flight together. The
 * weather needs coordinates, so it waits for the city; the feed does not. */
export async function gatherFacts(now: Date, doFetch: Fetch = fetch): Promise<GatheredFacts> {
	const news = fetchNews(doFetch);
	const place = await fetchPlace(doFetch);
	const weather = place ? await fetchWeather(place.latitude, place.longitude, doFetch) : undefined;
	return {
		place: place?.city,
		tempC: weather?.tempC,
		sky: skyFor(weather?.code),
		headline: freshest(await news, now),
	};
}

export interface BriefRequest {
	name: string;
	now: Date;
	doFetch?: Fetch;
	/** Asked for a line only when no fresh headline exists. May answer nothing,
	 * in which case the brief simply has no day's line. */
	joke?: () => Promise<string | undefined>;
}

/** The whole spoken brief, ready to be read. */
export async function morningBrief(request: BriefRequest): Promise<string> {
	const facts = await gatherFacts(request.now, request.doFetch ?? fetch);
	let extra: string | undefined;
	if (facts.headline) {
		extra = headlineLine(facts.headline);
	} else if (request.joke) {
		try {
			extra = await request.joke();
		} catch {
			// A failed joke is not worth a word: the brief goes out without it.
			extra = undefined;
		}
	}
	return buildBrief({ name: request.name, now: request.now, place: facts.place, tempC: facts.tempC, sky: facts.sky, extra });
}
