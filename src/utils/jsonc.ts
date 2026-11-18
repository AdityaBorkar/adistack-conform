import { parse, printParseErrorCode, stripComments, type ParseError } from "jsonc-parser";

// Comment-tolerant JSON with trailing commas (conform.json, blueprints).
export function stripJsonc(text: string): string {
	return stripComments(text);
}

export function parseJsonc(text: string): unknown {
	const errors: ParseError[] = [];
	const value = parse(text, errors, { allowTrailingComma: true });
	if (errors.length > 0) {
		const detail = errors
			.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
			.join("; ");
		throw new Error(`Invalid JSONC: ${detail}.`);
	}
	return value as unknown;
}
