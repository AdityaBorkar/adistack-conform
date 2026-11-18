import { apiJson, apiJsonPaged, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { fixOrPass, skipOnError } from "#/core/github/shared.js";
import type { CheckResult, GithubApiStep } from "#/core/result.js";
import { checkBase } from "#/core/result.js";

export type Ruleset = NonNullable<GithubSettings["rulesets"]>[number];
type Rules = Ruleset["rules"];
type Json = Record<string, unknown>;

// Manifest field ↔ API field per rule. Flag rules have no parameters.
const FLAG_RULES: Record<string, string> = {
	creation: "creation",
	deletion: "deletion",
	non_fast_forward: "non_fast_forward",
	required_linear_history: "required_linear_history",
	required_signatures: "required_signatures",
	update: "update",
};
const PARAM_RULES: Record<string, [type: string, fields: Record<string, string>]> = {
	code_coverage: [
		"code_coverage",
		{ max_coverage_drop: "max_coverage_drop", minimum_coverage: "minimum_coverage" },
	],
	code_quality: ["code_quality", { severity: "severity" }],
	copilot_code_review: [
		"copilot_code_review",
		{ review_draft_pull_requests: "review_draft_pull_requests", review_on_push: "review_on_push" },
	],
	merge_queue: [
		"merge_queue",
		{
			check_response_timeout_minutes: "check_response_timeout_minutes",
			grouping_strategy: "grouping_strategy",
			max_entries_to_build: "max_entries_to_build",
			max_entries_to_merge: "max_entries_to_merge",
			merge_method: "merge_method",
			min_entries_to_merge: "min_entries_to_merge",
			min_entries_to_merge_wait_minutes: "min_entries_to_merge_wait_minutes",
		},
	],
	pull_request: [
		"pull_request",
		{
			allowed_merge_methods: "allowed_merge_methods",
			dismiss_stale: "dismiss_stale_reviews_on_push",
			require_code_owner: "require_code_owner_review",
			require_conversation_resolution: "required_review_thread_resolution",
			require_extra_approval_for_copilot: "require_extra_approval_for_unattributed_changes",
			require_last_push_approval: "require_last_push_approval",
			required_approvals: "required_approving_review_count",
		},
	],
};
const STATUS_FIELDS = {
	do_not_enforce_on_create: "do_not_enforce_on_create",
	strict: "strict_required_status_checks_policy",
};
const CHECK_FIELDS = { context: "context", integration_id: "integration_id" };
const TOOL_FIELDS = {
	alerts: "alerts_threshold",
	security_alerts: "security_alerts_threshold",
	tool: "tool",
};
const ACTOR_FIELDS = { actor_id: "actor_id", actor_type: "actor_type", bypass_mode: "bypass_mode" };

// Renames keys by `fields` (manifest → API); `reverse` maps API → manifest.
// Undefined values are dropped so optional manifest fields stay unset.
function rename(source: unknown, fields: Record<string, string>, reverse = false): Json {
	const record = (source ?? {}) as Json;
	const out: Json = {};
	for (const [manifestKey, apiKey] of Object.entries(fields)) {
		const [from, to] = reverse ? [apiKey, manifestKey] : [manifestKey, apiKey];
		if (record[from] !== undefined) {
			out[to] = record[from];
		}
	}
	return out;
}

function renameAll(list: unknown, fields: Record<string, string>, reverse = false): Json[] {
	return (Array.isArray(list) ? list : []).map((item) => rename(item, fields, reverse));
}

export function rulesToApi(rules: Rules): Json[] {
	const out: Json[] = [];
	for (const [key, value] of Object.entries(rules)) {
		const flag = FLAG_RULES[key];
		const param = PARAM_RULES[key];
		if (flag !== undefined) {
			out.push({ type: flag });
		} else if (param !== undefined) {
			out.push({ parameters: rename(value, param[1]), type: param[0] });
		} else if (key === "required_deployments") {
			out.push({
				parameters: { required_deployment_environments: value },
				type: "required_deployments",
			});
		} else if (key === "required_status_checks") {
			const status = value as Json;
			out.push({
				parameters: {
					...rename(status, STATUS_FIELDS),
					required_status_checks: renameAll(status["checks"], CHECK_FIELDS),
				},
				type: "required_status_checks",
			});
		} else if (key === "code_scanning") {
			out.push({
				parameters: { code_scanning_tools: renameAll(value, TOOL_FIELDS) },
				type: "code_scanning",
			});
		}
	}
	return out;
}

// Live API rules → manifest shape. Unknown rule types keep their API type
// as the key so they count as present (and drift when undeclared).
export function rulesFromApi(rules: unknown): Json {
	const out: Json = {};
	for (const rule of Array.isArray(rules) ? (rules as Json[]) : []) {
		const type = String(rule["type"]);
		const params = (rule["parameters"] ?? {}) as Json;
		const flag = Object.entries(FLAG_RULES).find(([, api]) => api === type)?.[0];
		const param = Object.entries(PARAM_RULES).find(([, [api]]) => api === type);
		if (flag !== undefined) {
			out[flag] = true;
		} else if (param !== undefined) {
			out[param[0]] = rename(params, param[1][1], true);
		} else if (type === "required_deployments") {
			out["required_deployments"] = params["required_deployment_environments"] ?? [];
		} else if (type === "required_status_checks") {
			out["required_status_checks"] = {
				...rename(params, STATUS_FIELDS, true),
				checks: renameAll(params["required_status_checks"], CHECK_FIELDS, true),
			};
		} else if (type === "code_scanning") {
			out["code_scanning"] = renameAll(params["code_scanning_tools"], TOOL_FIELDS, true);
		} else {
			out[type] = params;
		}
	}
	return out;
}

export function rulesetBody(want: Ruleset): Json {
	return {
		...(want.bypass_actors === undefined
			? {}
			: { bypass_actors: renameAll(want.bypass_actors, ACTOR_FIELDS) }),
		conditions: { ref_name: { exclude: want.exclude ?? [], include: want.include } },
		enforcement: want.enforcement,
		name: want.name,
		rules: rulesToApi(want.rules),
		target: want.target,
	};
}

// Partial deep match: keys the manifest leaves out are not compared; arrays
// match order-free (same length, every wanted item matches some live item).
function matches(want: unknown, have: unknown): boolean {
	if (Array.isArray(want)) {
		return (
			Array.isArray(have) &&
			have.length === want.length &&
			want.every((item) => have.some((entry) => matches(item, entry)))
		);
	}
	if (typeof want === "object" && want !== null) {
		return (
			typeof have === "object" &&
			have !== null &&
			Object.entries(want).every(([key, value]) => matches(value, (have as Json)[key]))
		);
	}
	return Object.is(want, have);
}

// Names the drifted parts of one ruleset; [] when it matches.
export function rulesetDrift(want: Ruleset, live: Json): string[] {
	const ref = ((live["conditions"] as Json | undefined)?.["ref_name"] ?? {}) as Json;
	const have: Json = {
		bypass_actors: renameAll(live["bypass_actors"], ACTOR_FIELDS, true),
		enforcement: live["enforcement"],
		exclude: ref["exclude"] ?? [],
		include: ref["include"] ?? [],
		target: live["target"],
	};
	const drift: string[] = (
		["target", "enforcement", "include", "exclude", "bypass_actors"] as const
	).filter((key) => want[key] !== undefined && !matches(want[key], have[key]));
	const haveRules = rulesFromApi(live["rules"]);
	const ruleKeys = new Set([...Object.keys(want.rules), ...Object.keys(haveRules)]);
	for (const key of ruleKeys) {
		const wanted = (want.rules as Json)[key];
		if (wanted === undefined || !matches(wanted, haveRules[key])) {
			drift.push(`rules.${key}`);
		}
	}
	return drift;
}

// Code, planning, and automation → Rulesets (/settings/rules). Declared
// rulesets match by name; missing ones are POSTed, drifted ones PUT whole.
export async function checkRulesets(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const want = upstream.rulesets;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "rulesets", target);
	const diffs: string[] = [];
	const steps: GithubApiStep[] = [];
	try {
		const list = (await apiJsonPaged(
			repoPath(repo, "/rulesets?includes_parents=false&per_page=100"),
		)) as Json[];
		const lives = await Promise.all(
			want.map(async (ruleset) => {
				const found = list.find((entry) => entry["name"] === ruleset.name);
				return found === undefined
					? undefined
					: {
							id: String(found["id"]),
							live: (await apiJson(repoPath(repo, `/rulesets/${String(found["id"])}`))) as Json,
						};
			}),
		);
		for (const [index, ruleset] of want.entries()) {
			const found = lives[index];
			if (found === undefined) {
				diffs.push(`${ruleset.name}: missing`);
				steps.push({
					body: rulesetBody(ruleset),
					method: "POST",
					path: repoPath(repo, "/rulesets"),
				});
				continue;
			}
			const drift = rulesetDrift(ruleset, found.live);
			if (drift.length > 0) {
				diffs.push(`${ruleset.name}: ${drift.join(", ")}`);
				steps.push({
					body: rulesetBody(ruleset),
					method: "PUT",
					path: repoPath(repo, `/rulesets/${found.id}`),
				});
			}
		}
	} catch (error) {
		return skipOnError(error, base, "rulesets");
	}
	return fixOrPass(
		base,
		diffs,
		steps,
		`github rulesets ${repo}`,
		`rulesets: ${want.map((entry) => entry.name).join(", ") || "<none>"}`,
	);
}
