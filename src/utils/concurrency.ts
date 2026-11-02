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
	const runners = Array.from({ length: lanes }, () => {
		const runNext = (): Promise<void> => {
			if (next >= items.length) {
				return Promise.resolve();
			}
			const current = next;
			next += 1;
			const item = items[current] as T;
			return worker(item, current).then((value) => {
				results[current] = value;
				return runNext();
			});
		};
		return runNext();
	});
	await Promise.all(runners);
	return results;
}
