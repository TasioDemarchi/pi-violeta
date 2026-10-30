/**
 * In-memory outside-project grant store: per session, per target directory.
 * Deliberately ephemeral — never persisted, never restored; all grants are
 * dropped the moment the live session changes.
 */
export class OutsideGrants {
	private dirs = new Set<string>();
	private sessionId?: string;

	/** Drop everything when the live session changes; keep grants otherwise. */
	sync(sessionId: string): void {
		if (this.sessionId !== sessionId) {
			this.sessionId = sessionId;
			this.dirs.clear();
		}
	}

	has(dir: string): boolean {
		return this.dirs.has(dir);
	}

	grant(dir: string): void {
		this.dirs.add(dir);
	}

	/** Current grants, sorted, without duplicates. */
	list(): string[] {
		return [...this.dirs].sort();
	}

	/** Revoke everything; returns how many grants were dropped. */
	clear(): number {
		const count = this.dirs.size;
		this.dirs.clear();
		return count;
	}
}
