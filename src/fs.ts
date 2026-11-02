export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function readJsonFile(path: string, label: string): Promise<unknown> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`${label} not found: ${path}`);
	}
	try {
		return (await file.json()) as unknown;
	} catch (error) {
		throw new Error(`${label} has invalid JSON in ${path}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
}

export async function readTextFile(path: string): Promise<{ exists: boolean; text: string }> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		return { exists: false, text: "<missing>" };
	}
	return { exists: true, text: await file.text() };
}
