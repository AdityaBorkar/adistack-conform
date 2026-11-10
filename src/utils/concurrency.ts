export const DEFAULT_CONCURRENCY = 32;

export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) {
		return [];
	}
	const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_CONCURRENCY;
	const lanes = Math.min(safeLimit, items.length);
	const results = Array.from({ length: items.length }) as R[];
	let next = 0;
	let failed: unknown;
	let hasFailed = false;
	const runLane = async (): Promise<void> => {
		while (!hasFailed) {
			if (next >= items.length) {
				return;
			}
			const current = next;
			next += 1;
			const item = items[current] as T;
			try {
				results[current] = await worker(item, current);
			} catch (error) {
				hasFailed = true;
				failed ??= error;
				return;
			}
		}
	};
	const runners = Array.from({ length: lanes }, () => runLane());
	await Promise.all(runners);
	if (hasFailed) {
		throw failed;
	}
	return results as R[];
}
