function skipLineComment(text: string, index: number): number {
	let i = index;
	while (i < text.length && text[i] !== "\n") {
		i += 1;
	}
	return i;
}

function skipBlockComment(text: string, index: number): number {
	let i = index + 2;
	while (i < text.length) {
		if (text[i] === "*" && text[i + 1] === "/") {
			return i + 2;
		}
		i += 1;
	}
	throw new Error("Unterminated block comment in JSONC.");
}

function skipTrivia(text: string, index: number): number {
	let look = index;
	while (true) {
		while (look < text.length && /\s/u.test(text[look] as string)) {
			look += 1;
		}
		if (text[look] === "/" && text[look + 1] === "/") {
			look = skipLineComment(text, look);
			continue;
		}
		if (text[look] === "/" && text[look + 1] === "*") {
			look = skipBlockComment(text, look);
			continue;
		}
		return look;
	}
}

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
			i = skipLineComment(text, i);
			continue;
		}
		if (char === "/" && next === "*") {
			i = skipBlockComment(text, i);
			continue;
		}
		if (char === ",") {
			const peek = text[skipTrivia(text, i + 1)] as string | undefined;
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
