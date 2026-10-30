export function fmtTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtCost(usd: number): string {
	return usd > 0 && usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

export function fmtPercent(ratio: number): string {
	return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}
