import pLimit from "p-limit";

const DEFAULT_CONCURRENCY = 32;

export function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) {
		return Promise.resolve([]);
	}
	const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_CONCURRENCY;
	const run = pLimit(Math.min(safeLimit, items.length));
	return Promise.all(items.map((item, index) => run(() => worker(item, index))));
}
