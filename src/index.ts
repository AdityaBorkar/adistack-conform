#!/usr/bin/env bun
import * as prompts from "@clack/prompts";
import { Command } from "commander";

import type { CheckScope, CheckResult } from "#/checks.js";
import { applyFix, desiredContent, readActualContent, runChecks } from "#/checks.js";
import type { LoadedConfig, TechStackSpec } from "#/config.js";
import { defaultHome, loadConfig, resolveConfigPath } from "#/config.js";
import { renderDiff } from "#/diff.js";
import { buildSnapshot } from "#/init.js";
import { printResults } from "#/output.js";
import { runTechStackChecks } from "#/techstack.js";

const VERSION = "0.1.0";

function scopeOf(options: { projectOnly?: boolean; systemOnly?: boolean }): CheckScope | undefined {
	if (options.projectOnly === true && options.systemOnly === true) {
		throw new Error("Pass only one of --project-only / --system-only.");
	}
	if (options.projectOnly === true) {
		return "project";
	}
	if (options.systemOnly === true) {
		return "system";
	}
	return undefined;
}

function baseOptions(cmd: Command): { config: string; cwd: string } {
	const globals = cmd.optsWithGlobals<{ config: string; cwd: string }>();
	return { config: globals.config, cwd: globals.cwd };
}

async function runAllChecks(
	loaded: LoadedConfig,
	base: { config: string; cwd: string },
	only: CheckScope | undefined,
	refresh: boolean,
): Promise<CheckResult[]> {
	const home = defaultHome();
	const results = await runChecks(loaded.config, {
		baseDir: loaded.dir,
		configDir: loaded.dir,
		cwd: base.cwd,
		home,
		only,
	});
	if (loaded.config.techStack !== undefined && only !== "project") {
		results.push(...(await runTechStackChecks(loaded.config.techStack, { home, refresh })));
	}
	return results;
}

const program = new Command();
program
	.description("Check the current project/system-user against conform.config.json.")
	.name("adistack-conform")
	.option("--config <path>", "Path to conform.config.json", "conform.config.json")
	.option("--cwd <dir>", "Working directory for project-relative paths", process.cwd())
	.version(VERSION);

program
	.command("check")
	.description("Check conform.config.json against the current project/system-user.")
	.option("--json", "Print machine-readable JSON.")
	.option("--project-only", "Only run project checks.")
	.option("--refresh", "Re-download tech-stack blueprints/presets, ignoring the cache.")
	.option("--system-only", "Only run system checks.")
	.action(
		async (
			cmdOptions: {
				json?: boolean;
				projectOnly?: boolean;
				refresh?: boolean;
				systemOnly?: boolean;
			},
			cmd: Command,
		) => {
			const base = baseOptions(cmd);
			const only = scopeOf(cmdOptions);
			try {
				const loaded = await loadConfig(base.config, base.cwd);
				const results = await runAllChecks(loaded, base, only, cmdOptions.refresh === true);
				if (cmdOptions.json === true) {
					const failed = results.filter((item) => !item.ok);
					console.log(
						JSON.stringify(
							{
								config: loaded.path,
								failed: failed.length,
								ok: failed.length === 0,
								passed: results.length - failed.length,
								results,
								total: results.length,
							},
							null,
							2,
						),
					);
				} else {
					printResults(results);
				}
				process.exit(results.some((item) => !item.ok) ? 1 : 0);
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exit(2);
			}
		},
	);

program
	.command("fix")
	.description("Interactively fix drift (space to select, enter to apply).")
	.option("--all", "Apply all auto-fixable items without prompting.")
	.option("--dry-run", "Show what would be fixed without writing.")
	.option("--no-diff", "Hide the diff preview.")
	.option("--project-only", "Only fix project checks.")
	.option("--refresh", "Re-download tech-stack blueprints/presets, ignoring the cache.")
	.option("--system-only", "Only fix system checks.")
	.action(
		async (
			cmdOptions: {
				all?: boolean;
				diff?: boolean;
				dryRun?: boolean;
				projectOnly?: boolean;
				refresh?: boolean;
				systemOnly?: boolean;
			},
			cmd: Command,
		) => {
			const base = baseOptions(cmd);
			const showDiff = cmdOptions.diff !== false;
			try {
				const only = scopeOf(cmdOptions);
				const loaded = await loadConfig(base.config, base.cwd);
				const results = await runAllChecks(loaded, base, only, cmdOptions.refresh === true);
				const failed = results.filter((item) => !item.ok);
				const fixable = failed.filter((item) => item.fixable);
				const unfixable = failed.filter((item) => !item.fixable);

				if (failed.length === 0) {
					console.log("All conform checks passed.");
					process.exit(0);
				}

				for (const item of unfixable) {
					console.error(`✗ ${item.id} cannot be auto-fixed.`);
					console.error(`    target   : ${item.target}`);
					console.error(`    expected : ${item.expected}`);
					console.error(`    actual   : ${item.actual}`);
					if (item.hint) {
						console.error(`    fix manually: ${item.hint}`);
					}
				}

				if (fixable.length === 0) {
					process.exit(1);
				}

				if (showDiff) {
					const rendered = await Promise.all(
						fixable.map(async (item) => {
							const actual = await readActualContent(item);
							return `\ndiff ${item.id} (${item.target})\n${renderDiff("actual", "expected", actual, desiredContent(item))}`;
						}),
					);
					for (const text of rendered) {
						console.log(text);
					}
				}

				let selected: CheckResult[] = fixable;
				if (cmdOptions.all !== true) {
					if (cmdOptions.dryRun === true) {
						console.log(`\nDry run: ${fixable.length} item(s) would be fixed.`);
						for (const item of fixable) {
							console.log(`  - ${item.id} (${item.target})`);
						}
						process.exit(1);
					}
					if (!process.stdin.isTTY) {
						console.error("Not a TTY: re-run with --all to apply fixes non-interactively.");
						process.exit(2);
					}
					prompts.intro("Select fixes to apply (space to toggle, enter to confirm).");
					const choice = await prompts.multiselect({
						message: "Pick items to fix.",
						options: [
							{ label: `Select all (${fixable.length} items)`, value: "__all" },
							...fixable.map((item) => ({
								hint: item.target,
								label: item.id,
								value: item.id,
							})),
						],
						required: false,
					});
					if (prompts.isCancel(choice) || choice.length === 0) {
						prompts.outro("No fixes applied.");
						process.exit(1);
					}
					const ids = new Set(choice as string[]);
					if (ids.has("__all")) {
						selected = fixable;
					} else {
						selected = fixable.filter((item) => ids.has(item.id));
					}
					if (selected.length === 0) {
						prompts.outro("No fixes applied.");
						process.exit(1);
					}
				} else if (cmdOptions.dryRun === true) {
					console.log(`Dry run: ${fixable.length} item(s) would be fixed.`);
					for (const item of fixable) {
						console.log(`  - ${item.id} (${item.target})`);
					}
					process.exit(1);
				}

				let applied = 0;
				for (const item of selected) {
					try {
						await applyFix(item);
						applied += 1;
						console.log(`✓ fixed ${item.id}`);
					} catch (error) {
						console.error(
							`✗ not fixed ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}

				const rerun = await runAllChecks(loaded, base, only, cmdOptions.refresh === true);
				const remaining = rerun.filter((item) => !item.ok);
				console.log(
					`\nFixed ${applied}/${selected.length}. ${remaining.length} check(s) still failing.`,
				);
				if (remaining.length > 0) {
					printResults(rerun);
					process.exit(1);
				}
				prompts.outro("All conform checks passed.");
				process.exit(0);
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exit(2);
			}
		},
	);

program
	.command("init")
	.description("Create a conform.config.json snapshot from the current project/system-user.")
	.option("--blueprint <name>", "Pre-existing tech-stack blueprint to enforce.")
	.option("--exclude <names...>", "Tech-stack presets to drop from the blueprint.")
	.option("--force", "Overwrite an existing config file.")
	.option("--id <owner/repo>", "GitHub repo holding blueprints/presets (or set TECH_STACK_ID).")
	.option("--minimal", "Only snapshot project checks (skip system-user).")
	.option("--preset <names...>", "Tech-stack preset(s) to enforce (own blueprint).")
	.option("--ref <ref>", "GitHub branch, tag, or commit (or set TECH_STACK_REF; default: main).")
	.option("--source <name>", "Blueprint/preset source; only “github” is supported.")
	.option("--stdout", "Print to stdout instead of writing a file.")
	.action(
		async (
			cmdOptions: {
				blueprint?: string;
				exclude?: string[];
				force?: boolean;
				id?: string;
				minimal?: boolean;
				preset?: string[];
				ref?: string;
				source?: string;
				stdout?: boolean;
			},
			cmd: Command,
		) => {
			const base = baseOptions(cmd);
			try {
				const wantsTechStack =
					cmdOptions.blueprint !== undefined ||
					cmdOptions.exclude !== undefined ||
					cmdOptions.id !== undefined ||
					cmdOptions.preset !== undefined ||
					cmdOptions.ref !== undefined ||
					cmdOptions.source !== undefined;
				let techStack: TechStackSpec | undefined;
				if (wantsTechStack) {
					const id = cmdOptions.id ?? process.env["TECH_STACK_ID"];
					if (id === undefined || id === "") {
						throw new Error(
							"Missing tech-stack repo: pass --id <owner/repo> or set TECH_STACK_ID.",
						);
					}
					const source = cmdOptions.source ?? "github";
					if (source !== "github") {
						throw new Error(
							`Unsupported tech-stack source: ${source} (only “github” is supported).`,
						);
					}
					techStack = {
						blueprint: cmdOptions.blueprint,
						exclude: cmdOptions.exclude ?? [],
						fix: "overwrite",
						id,
						presets: cmdOptions.preset ?? [],
						ref: cmdOptions.ref ?? process.env["TECH_STACK_REF"] ?? "main",
						source: "github",
					};
				}
				const snapshot = await buildSnapshot(base.cwd, {
					minimal: cmdOptions.minimal === true,
					techStack,
				});
				const text = `${JSON.stringify(snapshot, null, 2)}\n`;
				if (cmdOptions.stdout === true) {
					console.log(text);
					return;
				}
				const outPath = resolveConfigPath(base.config, base.cwd);
				if ((await Bun.file(outPath).exists()) && cmdOptions.force !== true) {
					console.error(`Refusing to overwrite ${outPath} (pass --force).`);
					process.exit(2);
				}
				await Bun.write(outPath, text);
				console.log(`Wrote ${outPath}`);
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exit(2);
			}
		},
	);

program.parseAsync(process.argv);
