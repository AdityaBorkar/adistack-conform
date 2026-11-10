export function stripJsonc(text: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	let i = 0;
	while (i < text.length) {
		const char = text[i] as string;
		const next = (text[i + 1] ?? "") as string;
		if (inString) {
			out += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			i += 1;
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			i += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") {
				i += 1;
			}
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			let closed = false;
			while (i < text.length) {
				if (text[i] === "*" && text[i + 1] === "/") {
					closed = true;
					break;
				}
				i += 1;
			}
			i += closed ? 2 : 0;
			continue;
		}
		if (char === ",") {
			let look = i + 1;
			while (look < text.length && /\s/u.test(text[look] as string)) {
				look += 1;
			}
			const peek = text[look] as string | undefined;
			if (peek === "}" || peek === "]") {
				i += 1;
				continue;
			}
		}
		out += char;
		i += 1;
	}
	return out;
}

export function parseJsonc(text: string): unknown {
	return JSON.parse(stripJsonc(text)) as unknown;
}
