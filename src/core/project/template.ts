import { deepEqual, isRecord } from "#/utils/json.js";
import { parseJsonc, stripJsonc } from "#/utils/jsonc.js";

// Template slots in upstreams (e.g. package.json `<package-name>`). An upstream
// that parses as a JSON object and holds `<...>` placeholders is a template:
// every slot accepts any per-project value, all other fields must match.
const PLACEHOLDER = /<[^<>\r\n]+>/u;
const PLACEHOLDER_ALL = /<[^<>\r\n]+>/gu;

export function upstreamPlaceholders(upstream: string): string[] {
	return [...new Set(upstream.match(PLACEHOLDER_ALL) ?? [])];
}

// Placeholders in non-JSON upstreams (HTML comments, TS generics) never count:
// only an upstream that parses as JSON and holds `<...>` slots is a template.
export function isTemplateUpstream(upstream: string): boolean {
	let parsed: unknown;
	try {
		parsed = parseJsonc(upstream);
	} catch {
		return false;
	}
	if (!isRecord(parsed) && !Array.isArray(parsed)) {
		return false;
	}
	return PLACEHOLDER.test(stripJsonc(upstream));
}

// An upstream string with `<...>` slots matches any local string holding real
// values in those slots (each slot needs at least one char). Segment-wise
// scan: memoized backtracking bounds the blow-up. Each
// literal is tried at every occurrence (backtracking) so repeated suffixes
// still match (e.g. `a<x>aa` accepts `aaaaa`).
function templateStringMatches(upstream: string, local: string): boolean {
	const parts = upstream.split(/<[^<>\r\n]+>/u);
	if (parts.length === 1) {
		return upstream === local;
	}
	const first = parts[0] as string;
	if (!local.startsWith(first)) {
		return false;
	}
	const rest = parts.slice(1);
	const failed = new Set<string>();
	function matchFrom(segment: number, pos: number): boolean {
		const key = `${segment}:${pos}`;
		if (failed.has(key)) {
			return false;
		}
		if (segment === rest.length) {
			const ok = pos === local.length;
			if (!ok) {
				failed.add(key);
			}
			return ok;
		}
		const part = rest[segment] as string;
		if (part === "") {
			if (segment === rest.length - 1) {
				const ok = local.length - pos >= 1;
				if (!ok) {
					failed.add(key);
				}
				return ok;
			}
			if (pos >= local.length) {
				failed.add(key);
				return false;
			}
			const ok = matchFrom(segment + 1, pos + 1);
			if (!ok) {
				failed.add(key);
			}
			return ok;
		}
		let found = local.indexOf(part, pos + 1);
		while (found !== -1) {
			if (matchFrom(segment + 1, found + part.length)) {
				return true;
			}
			found = local.indexOf(part, found + 1);
		}
		failed.add(key);
		return false;
	}
	return matchFrom(0, first.length);
}

export function containsPlaceholderText(text: string): boolean {
	return PLACEHOLDER.test(text);
}

// A local value that is itself a `<...>` token is an unadapted leftover, not a
// per-project value. Angle brackets embedded in a larger value (e.g. `Array<T>`)
// are fine and match template slots by surrounding text.
function isLeftoverPlaceholder(value: string): boolean {
	return /^<[^<>\r\n]+>$/u.test(value.trim());
}

function placeholderValueMatches(upstreamValue: unknown, localValue: unknown): boolean {
	if (typeof upstreamValue === "string" && containsPlaceholderText(upstreamValue)) {
		return (
			typeof localValue === "string" &&
			localValue.trim() !== "" &&
			!isLeftoverPlaceholder(localValue) &&
			templateStringMatches(upstreamValue, localValue)
		);
	}
	if (isRecord(upstreamValue) || Array.isArray(upstreamValue)) {
		const nested: string[] = [];
		collectTemplateIssues(upstreamValue, localValue, "", nested, 0);
		return nested.length === 0;
	}
	return deepEqual(upstreamValue, localValue);
}

const MAX_TEMPLATE_DEPTH = 50;

// Every upstream field must hold in local: `<...>` slots accept any real value,
// all other fields must match exactly. Extra local fields are allowed.
export function collectTemplateIssues(
	upstreamNode: unknown,
	localNode: unknown,
	path: string,
	issues: string[],
	depth: number,
): void {
	if (depth > MAX_TEMPLATE_DEPTH) {
		issues.push(`${path === "" ? "value" : path} is nested too deeply to compare`);
		return;
	}
	if (typeof upstreamNode === "string" && containsPlaceholderText(upstreamNode)) {
		const label = path === "" ? "value" : path;
		if (typeof localNode !== "string" || localNode.trim() === "") {
			issues.push(`${label} needs a per-project value`);
			return;
		}
		if (isLeftoverPlaceholder(localNode)) {
			issues.push(`${label} still holds placeholders`);
			return;
		}
		if (!templateStringMatches(upstreamNode, localNode)) {
			issues.push(`${label} does not match the template`);
		}
		return;
	}
	if (isRecord(upstreamNode)) {
		if (!isRecord(localNode)) {
			issues.push(`${path === "" ? "value" : path} should be an object`);
			return;
		}
		const unmatched = new Set(Object.keys(localNode));
		for (const [key, upstreamValue] of Object.entries(upstreamNode)) {
			const child = path === "" ? key : `${path}.${key}`;
			if (containsPlaceholderText(key)) {
				const match = [...unmatched].find(
					(candidate) =>
						!containsPlaceholderText(candidate) &&
						!Object.hasOwn(upstreamNode, candidate) &&
						placeholderValueMatches(upstreamValue, localNode[candidate]),
				);
				if (match === undefined) {
					issues.push(`${child} needs a per-project value`);
				} else {
					unmatched.delete(match);
				}
				continue;
			}
			unmatched.delete(key);
			if (!Object.hasOwn(localNode, key)) {
				issues.push(`${child} is missing`);
				continue;
			}
			collectTemplateIssues(upstreamValue, localNode[key], child, issues, depth + 1);
		}
		return;
	}
	if (Array.isArray(upstreamNode)) {
		const label = path === "" ? "value" : path;
		if (!Array.isArray(localNode)) {
			issues.push(`${label} should be an array`);
			return;
		}
		if (localNode.length < upstreamNode.length) {
			issues.push(`${label} is missing entries`);
		}
		const shared = Math.min(upstreamNode.length, localNode.length);
		for (let index = 0; index < shared; index += 1) {
			collectTemplateIssues(
				upstreamNode[index],
				localNode[index],
				`${label}[${index}]`,
				issues,
				depth + 1,
			);
		}
		for (let index = shared; index < localNode.length; index += 1) {
			const extra = localNode[index];
			if (typeof extra === "string" && isLeftoverPlaceholder(extra)) {
				issues.push(`${label}[${index}] still holds placeholders`);
			}
		}
		return;
	}
	if (!deepEqual(upstreamNode, localNode)) {
		issues.push(`${path === "" ? "value" : path} differs from the upstream`);
	}
}
