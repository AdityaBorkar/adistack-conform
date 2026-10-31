import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import untildify from "untildify";
import * as z from "zod";

const MatchSchema = z.enum(["contains", "exact", "regex"]);

const FileCheckSchema = z
	.object({
		contains: z.array(z.string().min(1)).optional(),
		expected: z.string().optional(),
		expectedFile: z.string().optional(),
		id: z.string().min(1).optional(),
		mustExist: z.boolean().optional(),
		path: z.string().min(1),
	})
	.refine((value) => value.expected === undefined || value.expectedFile === undefined, {
		message: "File check cannot set both `expected` and `expectedFile`.",
	});

const JsonFieldCheckSchema = z.object({
	expect: z.unknown(),
	fix: z.enum(["report", "set"]).default("set"),
	id: z.string().min(1).optional(),
	path: z.string().min(1),
	pointer: z.string().min(1),
});

const CommandCheckSchema = z.object({
	expect: z.string(),
	fixHint: z.string().optional(),
	id: z.string().min(1),
	match: MatchSchema.default("exact"),
	run: z.string().min(1),
});

const BinaryCheckSchema = z.object({
	args: z.array(z.string()).default(["--version"]),
	bin: z.string().min(1),
	expect: z.string(),
	fixHint: z.string().optional(),
	id: z.string().min(1).optional(),
	match: MatchSchema.default("contains"),
});

const EnvCheckSchema = z.object({
	expect: z.string().optional(),
	fixHint: z.string().optional(),
	match: MatchSchema.default("exact"),
	mustExist: z.boolean().default(true),
	name: z.string().min(1),
});

const ProjectSectionSchema = z.object({
	commands: z.array(CommandCheckSchema).default([]),
	files: z.array(FileCheckSchema).default([]),
	json: z.array(JsonFieldCheckSchema).default([]),
});

const SystemSectionSchema = z.object({
	binaries: z.array(BinaryCheckSchema).default([]),
	env: z.array(EnvCheckSchema).default([]),
	files: z.array(FileCheckSchema).default([]),
});

const TechStackSpecSchema = z.object({
	blueprint: z.string().min(1).optional(),
	exclude: z.array(z.string().min(1)).default([]),
	fix: z.enum(["overwrite", "report"]).default("overwrite"),
	id: z.string().regex(/^[^/\s]+\/[^/\s]+$/u, "Expected techStack.id as “owner/repo”."),
	presets: z.array(z.string().min(1)).default([]),
	ref: z.string().min(1).default("main"),
	source: z.literal("github"),
});

export type TechStackSpec = z.infer<typeof TechStackSpecSchema>;

export const ConformConfigSchema = z.object({
	$schema: z.string().optional(),
	project: ProjectSectionSchema.default({ commands: [], files: [], json: [] }),
	system: SystemSectionSchema.default({ binaries: [], env: [], files: [] }),
	techStack: TechStackSpecSchema.optional(),
	version: z.literal(1),
});

export type ConformConfig = z.infer<typeof ConformConfigSchema>;

export interface LoadedConfig {
	config: ConformConfig;
	dir: string;
	path: string;
}

export function resolveTargetPath(raw: string, baseDir: string, home: string): string {
	const expanded =
		raw === "~" ? home : raw.startsWith("~/") ? join(home, raw.slice(2)) : untildify(raw);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(baseDir, expanded);
}

export function resolveConfigPath(raw: string, cwd: string): string {
	if (isAbsolute(raw)) {
		return raw;
	}
	return resolve(cwd, raw);
}

export async function loadConfig(configPath: string, cwd: string): Promise<LoadedConfig> {
	const path = resolveConfigPath(configPath, cwd);
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`Config not found: ${path}\nRun \`adistack-conform init\` to create one.`);
	}
	let parsed: unknown;
	try {
		parsed = await file.json();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in ${path}: ${detail}`, { cause: error });
	}
	const result = ConformConfigSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid conform config in ${path}:\n${z.prettifyError(result.error)}`);
	}
	return { config: result.data, dir: dirname(path), path };
}

export function defaultHome(): string {
	return process.env["HOME"] ?? homedir();
}
