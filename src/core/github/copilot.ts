import { isDeepStrictEqual } from "node:util";

import { apiJson, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { diffField, fixOrPass, skipOnError } from "#/core/github/shared.js";
import type { CheckResult } from "#/core/result.js";
import { checkBase, failManual, pass } from "#/core/result.js";

const UNAVAILABLE = { 404: "Copilot settings not available for this repository" };

// Copilot → Code review (GET/PATCH /copilot/code-review/settings). The live
// review_effort is {configured, effective}; configured null = "inherit".
export async function checkCopilotCodeReview(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const want = upstream.copilot?.code_review;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "copilot-code-review", target);
	const path = repoPath(repo, "/copilot/code-review/settings");
	const diffs: string[] = [];
	const body: Record<string, unknown> = {};
	try {
		const actual = (await apiJson(path)) as Record<string, unknown>;
		const effort = (actual["review_effort"] ?? {}) as { configured?: unknown };
		diffField(
			diffs,
			body,
			{ review_effort: effort.configured ?? "inherit" },
			"review_effort",
			want.review_effort,
		);
		diffField(diffs, body, actual, "severity_filter", want.severity_filter);
		diffField(diffs, body, actual, "mcp_enabled", want.mcp_enabled);
		diffField(diffs, body, actual, "cross_repo_context_enabled", want.cross_repo_context);
		diffField(diffs, body, actual, "custom_instructions_enabled", want.custom_instructions);
	} catch (error) {
		return skipOnError(error, base, "Copilot code review settings", UNAVAILABLE);
	}
	return fixOrPass(
		base,
		diffs,
		[{ body, method: "PATCH", path }],
		`github PATCH ${repo} copilot code review`,
		"copilot code review match",
	);
}

// Copilot → Cloud, Internet access (cloud), MCP servers. READ: the
// cloud-agent configuration endpoint has no write, so drift is manual.
export async function checkCopilotCloud(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const copilot = upstream.copilot;
	const cloud = copilot?.cloud;
	const net = copilot?.internet_access?.cloud;
	const tools = cloud?.validation_tools;
	const fields: Array<[key: string, want: unknown, page: string]> = [
		["require_actions_workflow_approval", cloud?.require_workflow_approval, "Cloud → Policies"],
		["is_automations_enabled", cloud?.automations?.enabled, "Cloud → Automations"],
		[
			"require_write_access_for_automation_triggers",
			cloud?.automations?.require_write_access,
			"Cloud → Automations",
		],
		["enabled_tools.codeql", tools?.codeql, "Cloud → Validation tools"],
		["enabled_tools.copilot_code_review", tools?.copilot_code_review, "Cloud → Validation tools"],
		["enabled_tools.secret_scanning", tools?.secret_scanning, "Cloud → Validation tools"],
		[
			"enabled_tools.dependency_vulnerability_checks",
			tools?.dependency_vulnerability_checks,
			"Cloud → Validation tools",
		],
		["is_firewall_enabled", net?.firewall, "Internet access → Copilot in the cloud"],
		[
			"is_firewall_recommended_allowlist_enabled",
			net?.recommended_allowlist,
			"Internet access → Copilot in the cloud",
		],
		[
			"custom_allowlist",
			net?.custom_allowlist?.toSorted(),
			"Internet access → Copilot in the cloud",
		],
		["mcp_configuration", copilot?.mcp?.configuration, "MCP servers"],
	];
	const managed = fields.filter(([, want]) => want !== undefined);
	if (managed.length === 0) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "copilot-cloud", target);
	let actual: Record<string, unknown>;
	try {
		actual = (await apiJson(repoPath(repo, "/copilot/cloud-agent/configuration"))) as Record<
			string,
			unknown
		>;
	} catch (error) {
		return skipOnError(error, base, "Copilot cloud agent configuration", UNAVAILABLE);
	}
	const read = (key: string): unknown => {
		const [head, leaf] = key.split(".");
		const value = actual[head ?? ""];
		if (leaf !== undefined) {
			return (value as Record<string, unknown> | undefined)?.[leaf];
		}
		return Array.isArray(value) ? value.map(String).toSorted() : value;
	};
	const drift = managed.filter(([key, want]) => !isDeepStrictEqual(read(key), want));
	if (drift.length === 0) {
		return pass(base, "copilot cloud match", "copilot cloud match");
	}
	return failManual(
		base,
		drift
			.map(([key, want]) => `${key}: ${JSON.stringify(read(key))} → ${JSON.stringify(want)}`)
			.join("; "),
		"copilot cloud match",
		`No write API: set it in Settings → Copilot → ${[...new Set(drift.map(([, , page]) => page))].join(", ")}, then re-check.`,
	);
}
