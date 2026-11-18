// JSON helpers: indent-preserving serialize, deep equality and
// prototype-safe key handling.
import equal from "fast-deep-equal";
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

export const deepEqual: (left: unknown, right: unknown) => boolean = equal;
