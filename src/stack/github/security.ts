import { apiEnabled, apiJson, apiJsonPaged, isAuthError, repoPath } from "#/stack/github-api.js";
import type { GithubSettings } from "#/stack/github/shared.js";
import { baseFor, diffSummary } from "#/stack/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/utils/result.js";
import { failFixable, failManual, pass, skipped } from "#/utils/result.js";

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

export async function checkSecurity(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
	repoInfo: () => Promise<Record<string, unknown>>,
): Promise<CheckResult[]> {
	const base = baseFor(blueprint, "security", target);
	const notes: CheckResult[] = [];
	let analysis: Record<string, unknown>;
	try {
		analysis = ((await repoInfo()).security_and_analysis ?? {}) as Record<string, unknown>;
	} catch (error) {
		if (isAuthError(error)) {
			return [skipped(base, "cannot read repo settings", "set GITHUB_TOKEN to verify")];
		}
		throw error;
	}
	const diffs: string[] = [];
	const patch: Record<string, { status: string }> = {};
	const compareSecurity = (key: string, want: boolean): void => {
		const have = securityStatus(analysis[key]);
		if ((have === "enabled") !== want) {
			diffs.push(`${key}: ${have} → ${want ? "enabled" : "disabled"}`);
			patch[key] = { status: want ? "enabled" : "disabled" };
		}
	};
	compareSecurity("secret_scanning", upstream.security.secretProtection);
	compareSecurity("secret_scanning_push_protection", upstream.security.pushProtection);
	const steps: GithubApiStep[] = [];
	if (Object.keys(patch).length > 0) {
		steps.push({
			body: { security_and_analysis: patch },
			method: "PATCH",
			path: repoPath(repo, ""),
		});
	}
	try {
		const vuln = (await apiJson(repoPath(repo, "/private-vulnerability-reporting"), {
			allowStatuses: [404],
		})) as { enabled?: unknown } | undefined;
		const enabled = isPrivateVulnEnabled(vuln);
		if (enabled !== upstream.security.privateVulnerabilityReporting) {
			diffs.push(
				`private_vulnerability_reporting: ${String(enabled)} → ${String(upstream.security.privateVulnerabilityReporting)}`,
			);
			steps.push({
				method: upstream.security.privateVulnerabilityReporting ? "PUT" : "DELETE",
				path: repoPath(repo, "/private-vulnerability-reporting"),
			});
		}
	} catch (error) {
		if (isAuthError(error)) {
			notes.push(
				skipped(
					baseFor(blueprint, "security-vuln-reporting", target),
					"cannot read private vulnerability reporting",
					"set GITHUB_TOKEN to verify",
				),
			);
		} else {
			throw error;
		}
	}
	try {
		const dependabot = (await apiJson(repoPath(repo, "/automated-security-fixes"), {
			allowStatuses: [404],
		})) as { enabled?: unknown; paused?: unknown } | undefined;
		const enabled =
			dependabot !== undefined && dependabot["enabled"] === true && dependabot["paused"] !== true;
		if (enabled !== upstream.security.dependabot) {
			diffs.push(`dependabot: ${String(enabled)} → ${String(upstream.security.dependabot)}`);
			steps.push({
				method: upstream.security.dependabot ? "PUT" : "DELETE",
				path: repoPath(repo, "/automated-security-fixes"),
			});
		}
	} catch (error) {
		if (isAuthError(error)) {
			notes.push(
				skipped(
					baseFor(blueprint, "security-dependabot", target),
					"cannot read Dependabot status",
					"set GITHUB_TOKEN to verify",
				),
			);
		} else {
			throw error;
		}
	}
	try {
		// PUT /vulnerability-alerts enables dependency alerts and the dependency graph together.
		const graphOn = await apiEnabled(repoPath(repo, "/vulnerability-alerts"));
		if (graphOn !== upstream.security.dependencyGraph) {
			diffs.push(
				`dependency_graph: ${String(graphOn)} → ${String(upstream.security.dependencyGraph)}`,
			);
			steps.push({
				method: upstream.security.dependencyGraph ? "PUT" : "DELETE",
				path: repoPath(repo, "/vulnerability-alerts"),
			});
		}
	} catch (error) {
		if (isAuthError(error)) {
			notes.push(
				skipped(
					baseFor(blueprint, "security-dependency-graph", target),
					"cannot read dependency graph status",
					"set GITHUB_TOKEN to verify",
				),
			);
		} else {
			throw error;
		}
	}
	if (diffs.length === 0) {
		return [pass(base, "security settings match", "security settings match"), ...notes];
	}
	if (steps.length === 0) {
		return [
			failManual(
				base,
				diffSummary(diffs),
				"security settings match",
				"Toggle in Settings → Code security, then re-run check (needs GITHUB_TOKEN).",
			),
			...notes,
		];
	}
	const fix: GithubApiFix = { kind: "github-api", label: `github PATCH ${repo} security`, steps };
	return [failFixable(base, diffSummary(diffs), "security settings match", fix), ...notes];
}

export async function checkSecrets(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = baseFor(blueprint, "secrets", target);
	if (upstream.secrets.length === 0 && upstream.variables.length === 0) {
		return skipped(base, "no secrets/variables required", "list names to enforce presence");
	}
	let haveSecrets: string[] = [];
	let haveVariables: string[] = [];
	try {
		const [secretItems, variableItems] = await Promise.all([
			apiJsonPaged(repoPath(repo, "/actions/secrets"), "secrets"),
			apiJsonPaged(repoPath(repo, "/actions/variables"), "variables"),
		]);
		haveSecrets = (secretItems as Array<{ name?: unknown }>).map((entry) => String(entry.name));
		haveVariables = (variableItems as Array<{ name?: unknown }>).map((entry) => String(entry.name));
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot list secrets", "set GITHUB_TOKEN to verify secrets");
		}
		throw error;
	}
	const missingSecrets = upstream.secrets.filter((name) => !haveSecrets.includes(name));
	const missingVariables = upstream.variables.filter((name) => !haveVariables.includes(name));
	if (missingSecrets.length === 0 && missingVariables.length === 0) {
		return pass(base, "secrets/variables present", "secrets/variables match");
	}
	const missing = [
		...missingSecrets.map((name) => `secret:${name}`),
		...missingVariables.map((name) => `variable:${name}`),
	];
	return failManual(
		base,
		`missing: ${missing.join(", ")}`,
		"secrets/variables present",
		missingSecrets.length > 0
			? `Add values with e.g. gh secret set ${missingSecrets[0] ?? "NAME"} --repo ${repo}, then re-run check.`
			: `Add values with e.g. gh variable set ${missingVariables[0] ?? "NAME"} --repo ${repo}, then re-run check.`,
	);
}
