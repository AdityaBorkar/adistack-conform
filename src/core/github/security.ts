import { apiEnabled, apiJson, apiJsonPaged, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { checkSimpleEndpoint, diffField, fixOrPass, skipOnError } from "#/core/github/shared.js";
import type { CheckResult, GithubApiStep } from "#/core/result.js";
import { checkBase, failManual, pass, skipped } from "#/core/result.js";

export function isPrivateVulnEnabled(body?: unknown): boolean {
	if (typeof (body as { enabled?: unknown } | undefined)?.["enabled"] === "boolean") {
		return (body as { enabled: boolean }).enabled;
	}
	return body !== undefined;
}

function securityStatus(entry: unknown): string {
	if (typeof entry === "object" && entry !== null && "status" in entry) {
		const status = (entry as { status?: unknown }).status;
		if (typeof status === "string") {
			return status;
		}
	}
	// A missing key reads as disabled: absent means the protection is not on.
	return "disabled";
}

const onOff = (want: boolean | undefined): string | undefined =>
	want === undefined ? undefined : want ? "enabled" : "disabled";

// Advanced Security toggles with an API: Secret Protection
// (security_and_analysis PATCH), private vulnerability reporting, Dependabot
// alerts (/vulnerability-alerts) and security updates (/automated-security-fixes).
// Validity checks and custom patterns are READ: drift there is manual.
export async function checkSecurity(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
	repoInfo: () => Promise<Record<string, unknown>>,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "security", target);
	const adv = upstream.advanced_security;
	const secret = adv.secret_protection;
	const diffs: string[] = [];
	const manual: string[] = [];
	const steps: GithubApiStep[] = [];
	try {
		const analysis = ((await repoInfo())["security_and_analysis"] ?? {}) as Record<string, unknown>;
		const patch: Record<string, unknown> = {};
		const fields: Array<[string, boolean | undefined]> = [
			["secret_scanning", secret.enabled],
			["secret_scanning_push_protection", secret.push_protection],
			["secret_scanning_non_provider_patterns", secret.non_provider_patterns],
			["secret_scanning_ai_detection", secret.ai_detection],
			["secret_scanning_delegated_bypass", secret.delegated_bypass],
			["secret_scanning_delegated_alert_dismissal", secret.delegated_alert_dismissal],
		];
		for (const [key, want] of fields) {
			const status = onOff(want);
			if (status !== undefined && securityStatus(analysis[key]) !== status) {
				diffs.push(`${key}: ${securityStatus(analysis[key])} → ${status}`);
				patch[key] = { status };
			}
		}
		if (Object.keys(patch).length > 0) {
			steps.push({
				body: { security_and_analysis: patch },
				method: "PATCH",
				path: repoPath(repo, ""),
			});
		}
		const validity = onOff(secret.validity_checks);
		const haveValidity = securityStatus(analysis["secret_scanning_validity_checks"]);
		if (validity !== undefined && haveValidity !== validity) {
			manual.push(`secret_scanning_validity_checks: ${haveValidity} → ${validity}`);
		}
		if (secret.custom_patterns !== undefined && secret.custom_patterns.length > 0) {
			const patterns = ((await apiJson(repoPath(repo, "/secret-scanning/custom-patterns"), {
				allowStatuses: [404],
			})) ?? []) as Array<{ name?: unknown }>;
			const names = new Set(patterns.map((entry) => String(entry.name)));
			const missing = secret.custom_patterns.filter((name) => !names.has(name));
			if (missing.length > 0) {
				manual.push(`custom patterns missing: ${missing.join(", ")}`);
			}
		}
		const [vuln, alerts, fixes] = await Promise.all([
			apiJson(repoPath(repo, "/private-vulnerability-reporting"), { allowStatuses: [404] }),
			apiEnabled(repoPath(repo, "/vulnerability-alerts")),
			apiJson(repoPath(repo, "/automated-security-fixes"), { allowStatuses: [404] }) as Promise<
				{ enabled?: unknown; paused?: unknown } | undefined
			>,
		]);
		const toggles: Array<[label: string, have: boolean, want: boolean, path: string]> = [
			[
				"private_vulnerability_reporting",
				isPrivateVulnEnabled(vuln),
				adv.private_vulnerability_reporting.enabled,
				"/private-vulnerability-reporting",
			],
			// Alerts before security updates: updates need alerts on.
			["dependabot_alerts", alerts, adv.dependabot.alerts, "/vulnerability-alerts"],
			[
				"dependabot_security_updates",
				fixes?.enabled === true && fixes.paused !== true,
				adv.dependabot.security_updates,
				"/automated-security-fixes",
			],
		];
		for (const [label, have, want, path] of toggles) {
			if (have !== want) {
				diffs.push(`${label}: ${String(have)} → ${String(want)}`);
				steps.push({ method: want ? "PUT" : "DELETE", path: repoPath(repo, path) });
			}
		}
	} catch (error) {
		return skipOnError(error, base, "security settings");
	}
	if (diffs.length === 0 && manual.length > 0) {
		return failManual(
			base,
			manual.join("; "),
			"security settings match",
			"Set validity checks / custom patterns in Settings → Advanced Security → Secret Protection, then re-check.",
		);
	}
	const result = fixOrPass(
		base,
		[...diffs, ...manual],
		steps,
		`github PATCH ${repo} security`,
		"security settings match",
	);
	if (manual.length > 0) {
		result.hint =
			"Run `fix` for the rest; set validity checks / custom patterns in Settings → Advanced Security → Secret Protection.";
	}
	return result;
}

// Dependency graph has no repo API (the old check read /vulnerability-alerts,
// which is Dependabot alerts). It is always on for public repos.
export async function checkDependencyGraph(
	blueprint: string,
	upstream: GithubSettings,
	target: string,
	repoInfo: () => Promise<Record<string, unknown>>,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "security-dependency-graph", target);
	const want = upstream.advanced_security.dependency_graph;
	let isPublic: boolean;
	try {
		isPublic = (await repoInfo())["private"] === false;
	} catch (error) {
		return skipOnError(error, base, "repo visibility");
	}
	if (want && isPublic) {
		return pass(base, "dependency graph on (public repo)", "dependency graph on");
	}
	return skipped(
		base,
		`want dependency graph ${want ? "on" : "off"} (no API${isPublic ? "; always on for public repos" : ""})`,
		"confirm in Settings → Advanced Security → Dependency Scanning → Dependency graph",
	);
}

// Dependabot → self-hosted runner settings (404 when not offered for this repo).
export function checkDependabotRunner(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> | undefined {
	const want = upstream.advanced_security.dependabot.runner;
	if (want === undefined) {
		return undefined;
	}
	return checkSimpleEndpoint(
		checkBase("github", blueprint, "dependabot-runner", target),
		repo,
		"/dependabot/runner-settings",
		{ runner_group: want.group, runner_labels: want.labels, runner_type: want.type },
		"dependabot runner settings",
		{ 404: "Dependabot runner settings not available for this repository" },
	);
}

// Code Security → Tools → CodeQL default setup (PATCH /code-scanning/default-setup).
// Wanted languages must be a subset: live lists aliases (javascript, typescript).
export async function checkCodeScanning(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const want = upstream.advanced_security.code_scanning.default_setup;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "code-scanning", target);
	const path = repoPath(repo, "/code-scanning/default-setup");
	const diffs: string[] = [];
	const body: Record<string, unknown> = {};
	try {
		const actual = (await apiJson(path)) as Record<string, unknown>;
		diffField(diffs, body, actual, "state", want.state);
		diffField(diffs, body, actual, "query_suite", want.query_suite);
		diffField(diffs, body, actual, "threat_model", want.threat_model);
		diffField(diffs, body, actual, "runner_type", want.runner_type);
		diffField(diffs, body, actual, "runner_label", want.runner_label);
		const have = Array.isArray(actual["languages"]) ? actual["languages"].map(String) : [];
		const missing = (want.languages ?? []).filter((lang) => !have.includes(lang));
		if (missing.length > 0) {
			diffs.push(`languages: missing ${missing.join(", ")}`);
			body["languages"] = want.languages;
		}
	} catch (error) {
		return skipOnError(error, base, "code scanning default setup", {
			404: "code scanning not available for this repository",
		});
	}
	return fixOrPass(
		base,
		diffs,
		[{ body: { ...body, state: want.state }, method: "PATCH", path }],
		`github PATCH ${repo} code scanning default setup`,
		`code scanning ${want.state}`,
	);
}

// Code Security → AI Scan for repositories / pull requests.
export function checkAiScan(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> | undefined {
	const want = upstream.advanced_security.code_scanning.ai_scan;
	if (want === undefined) {
		return undefined;
	}
	return checkSimpleEndpoint(
		checkBase("github", blueprint, "ai-scan", target),
		repo,
		"/code-scanning/ai-scan",
		{ pr_scan: onOff(want.pull_requests), repository_scan: onOff(want.repository) },
		"AI scan",
		{ 404: "AI Scan not available for this repository" },
		"PATCH",
	);
}

const env = (name: string): string => `/environments/${encodeURIComponent(name)}`;

// Secrets and variables (+ per-environment) are presence-only: values are
// write-only, so drift is manual with the matching `gh` command.
export async function checkSecrets(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "secrets", target);
	const want = upstream.secrets;
	const envs = Object.entries(upstream.environments);
	// [label, list path, collection key, wanted names, fix command]
	const groups: Array<[string, string, string, string[], string]> = [
		["secret", "/actions/secrets", "secrets", want.actions.secrets, "gh secret set NAME"],
		["variable", "/actions/variables", "variables", want.actions.variables, "gh variable set NAME"],
		[
			"agents-secret",
			"/agents/secrets",
			"secrets",
			want.agents?.secrets ?? [],
			"gh secret set NAME --app agents",
		],
		[
			"agents-variable",
			"/agents/variables",
			"variables",
			want.agents?.variables ?? [],
			"Settings → Secrets and variables → Agents (NAME)",
		],
		[
			"codespaces",
			"/codespaces/secrets",
			"secrets",
			want.codespaces ?? [],
			"gh secret set NAME --app codespaces",
		],
		[
			"dependabot",
			"/dependabot/secrets",
			"secrets",
			want.dependabot ?? [],
			"gh secret set NAME --app dependabot",
		],
		...envs.flatMap(([name, entry]): Array<[string, string, string, string[], string]> => [
			[
				`env:${name}`,
				`${env(name)}/secrets`,
				"secrets",
				entry.secrets ?? [],
				`gh secret set NAME --env ${name}`,
			],
			[
				`env-variable:${name}`,
				`${env(name)}/variables`,
				"variables",
				entry.variables ?? [],
				`gh variable set NAME --env ${name}`,
			],
		]),
	];
	const wanted = groups.filter(([, , , names]) => names.length > 0);
	if (wanted.length === 0) {
		return pass(base, "no secrets/variables required", "secrets/variables match");
	}
	let missing: Array<{ command: string; label: string; name: string }>;
	try {
		const lists = await Promise.all(
			wanted.map(([, path, collection]) => apiJsonPaged(repoPath(repo, path), collection)),
		);
		missing = wanted.flatMap(([label, , , names, command], index) => {
			const have = new Set(
				(lists[index] as Array<{ name?: unknown }>).map((entry) => String(entry.name)),
			);
			return names.filter((name) => !have.has(name)).map((name) => ({ command, label, name }));
		});
	} catch (error) {
		return skipOnError(error, base, "secrets");
	}
	if (missing.length === 0) {
		return pass(base, "secrets/variables present", "secrets/variables match");
	}
	const first = missing[0] as { command: string; name: string };
	const command = first.command.replace("NAME", first.name);
	return failManual(
		base,
		`missing: ${missing.map((entry) => `${entry.label}:${entry.name}`).join(", ")}`,
		"secrets/variables present",
		command.startsWith("gh ")
			? `Add values with e.g. ${command} --repo ${repo}, then re-check.`
			: `Add values in ${command} or via the API, then re-check.`,
	);
}
