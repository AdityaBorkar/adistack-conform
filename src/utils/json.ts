// JSON helpers: indent-preserving serialize, deep equality and
// prototype-safe key handling.
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
	// "__proto__" assignment would mutate the prototype instead of creating an
	// own property, so define it explicitly.
	if (key === "__proto__") {
		Object.defineProperty(target, key, {
			configurable: true,
			enumerable: true,
			value,
			writable: true,
		});
		return;
	}
	target[key] = value;
}

export function omitKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!keys.includes(key)) {
			setOwn(out, key, entry);
		}
	}
	return out;
}

function detectIndent(upstream: string): string {
	if (upstream.includes("\t")) {
		return "\t";
	}
	const match = /^( +)/mu.exec(upstream);
	return match?.[1] ?? "\t";
}

export function serializeJson(value: unknown, upstream: string): string {
	return `${JSON.stringify(value, null, detectIndent(upstream))}\n`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepEqual(left: unknown, right: unknown): boolean {
	if (left === right) {
		return true;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
		);
	}
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
		);
	}
	return false;
}
