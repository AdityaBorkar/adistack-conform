import { apiEnabled, apiJson, apiJsonPaged, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass, skipped } from "#/core/result.js";

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
	const base = checkBase("github", blueprint, "security", target);
	const notes: CheckResult[] = [];
	let analysis: Record<string, unknown>;
	try {
		analysis = ((await repoInfo()).security_and_analysis ?? {}) as Record<string, unknown>;
	} catch (error) {
		if (isAuthError(error)) {
			return [
				skipped(base, "cannot read repo settings", "set GITHUB_TOKEN (private repo or rate limit)"),
			];
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
	if (upstream.security.nonProviderPatterns !== undefined) {
		compareSecurity("secret_scanning_non_provider_patterns", upstream.security.nonProviderPatterns);
	}
	if (upstream.security.aiDetection !== undefined) {
		compareSecurity("secret_scanning_ai_detection", upstream.security.aiDetection);
	}
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
					checkBase("github", blueprint, "security-vuln-reporting", target),
					"cannot read private vulnerability reporting",
					"set GITHUB_TOKEN (private repo or rate limit)",
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
					checkBase("github", blueprint, "security-dependabot", target),
					"cannot read Dependabot status",
					"set GITHUB_TOKEN (private repo or rate limit)",
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
					checkBase("github", blueprint, "security-dependency-graph", target),
					"cannot read dependency graph status",
					"set GITHUB_TOKEN (private repo or rate limit)",
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
				diffs.join("; "),
				"security settings match",
				"Toggle in Settings → Code security, then re-check (needs GITHUB_TOKEN).",
			),
			...notes,
		];
	}
	const fix: GithubApiFix = { kind: "github-api", label: `github PATCH ${repo} security`, steps };
	return [failFixable(base, diffs.join("; "), "security settings match", fix), ...notes];
}

export async function checkSecrets(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "secrets", target);
	const wantCodespaces = upstream.codespacesSecrets ?? [];
	const wantDependabot = upstream.dependabotSecrets ?? [];
	const wantAgentsSecrets = upstream.agentsSecrets ?? [];
	const wantAgentsVariables = upstream.agentsVariables ?? [];
	const wantEnvSecrets = upstream.environmentSecrets ?? {};
	const wantEnvEnvs = Object.keys(wantEnvSecrets);
	if (
		upstream.secrets.length === 0 &&
		upstream.variables.length === 0 &&
		wantCodespaces.length === 0 &&
		wantDependabot.length === 0 &&
		wantAgentsSecrets.length === 0 &&
		wantAgentsVariables.length === 0 &&
		wantEnvEnvs.length === 0
	) {
		return pass(base, "no secrets/variables required", "secrets/variables match");
	}
	let haveSecrets: string[] = [];
	let haveVariables: string[] = [];
	let haveCodespaces: string[] = [];
	let haveDependabot: string[] = [];
	let haveAgentsSecrets: string[] = [];
	let haveAgentsVariables: string[] = [];
	const haveEnv: Record<string, string[]> = {};
	try {
		const [
			secretItems,
			variableItems,
			codespacesItems,
			dependabotItems,
			agentsSecretItems,
			agentsVariableItems,
		] = await Promise.all([
			apiJsonPaged(repoPath(repo, "/actions/secrets"), "secrets"),
			apiJsonPaged(repoPath(repo, "/actions/variables"), "variables"),
			wantCodespaces.length > 0
				? apiJsonPaged(repoPath(repo, "/codespaces/secrets"), "secrets")
				: Promise.resolve([]),
			wantDependabot.length > 0
				? apiJsonPaged(repoPath(repo, "/dependabot/secrets"), "secrets")
				: Promise.resolve([]),
			wantAgentsSecrets.length > 0
				? apiJsonPaged(repoPath(repo, "/agents/secrets"), "secrets")
				: Promise.resolve([]),
			wantAgentsVariables.length > 0
				? apiJsonPaged(repoPath(repo, "/agents/variables"), "variables")
				: Promise.resolve([]),
		]);
		haveSecrets = (secretItems as Array<{ name?: unknown }>).map((entry) => String(entry.name));
		haveVariables = (variableItems as Array<{ name?: unknown }>).map((entry) => String(entry.name));
		haveCodespaces = (codespacesItems as Array<{ name?: unknown }>).map((entry) =>
			String(entry.name),
		);
		haveDependabot = (dependabotItems as Array<{ name?: unknown }>).map((entry) =>
			String(entry.name),
		);
		haveAgentsSecrets = (agentsSecretItems as Array<{ name?: unknown }>).map((entry) =>
			String(entry.name),
		);
		haveAgentsVariables = (agentsVariableItems as Array<{ name?: unknown }>).map((entry) =>
			String(entry.name),
		);
		const envSecrets = await Promise.all(
			wantEnvEnvs.map(async (env) => ({
				env,
				items: (await apiJsonPaged(
					repoPath(repo, `/environments/${encodeURIComponent(env)}/secrets`),
					"secrets",
				)) as Array<{ name?: unknown }>,
			})),
		);
		for (const { env, items } of envSecrets) {
			haveEnv[env] = items.map((entry) => String(entry.name));
		}
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot list secrets", "set GITHUB_TOKEN (private repo or rate limit)");
		}
		throw error;
	}
	const missingSecrets = upstream.secrets.filter((name) => !haveSecrets.includes(name));
	const missingVariables = upstream.variables.filter((name) => !haveVariables.includes(name));
	const missingCodespaces = wantCodespaces.filter((name) => !haveCodespaces.includes(name));
	const missingDependabot = wantDependabot.filter((name) => !haveDependabot.includes(name));
	const missingAgentsSecrets = wantAgentsSecrets.filter(
		(name) => !haveAgentsSecrets.includes(name),
	);
	const missingAgentsVariables = wantAgentsVariables.filter(
		(name) => !haveAgentsVariables.includes(name),
	);
	const missingEnv = wantEnvEnvs.flatMap((env) =>
		(wantEnvSecrets[env] ?? [])
			.filter((name) => !(haveEnv[env] ?? []).includes(name))
			.map((name) => `${env}:${name}`),
	);
	if (
		missingSecrets.length === 0 &&
		missingVariables.length === 0 &&
		missingCodespaces.length === 0 &&
		missingDependabot.length === 0 &&
		missingAgentsSecrets.length === 0 &&
		missingAgentsVariables.length === 0 &&
		missingEnv.length === 0
	) {
		return pass(base, "secrets/variables present", "secrets/variables match");
	}
	const missing = [
		...missingSecrets.map((name) => `secret:${name}`),
		...missingVariables.map((name) => `variable:${name}`),
		...missingCodespaces.map((name) => `codespaces:${name}`),
		...missingDependabot.map((name) => `dependabot:${name}`),
		...missingAgentsSecrets.map((name) => `agents-secret:${name}`),
		...missingAgentsVariables.map((name) => `agents-variable:${name}`),
		...missingEnv.map((name) => `env:${name}`),
	];
	const firstEnv = missingEnv[0]?.split(":")[0] ?? "ENV";
	return failManual(
		base,
		`missing: ${missing.join(", ")}`,
		"secrets/variables present",
		missingAgentsSecrets.length > 0
			? `Add values with e.g. gh secret set ${missingAgentsSecrets[0] ?? "NAME"} --app agents --repo ${repo}, then re-check.`
			: missingAgentsVariables.length > 0
				? `Add values in Settings → Secrets → Agents (${missingAgentsVariables[0] ?? "NAME"}) or via the agents variables API, then re-check.`
				: missingCodespaces.length > 0
					? `Add values with e.g. gh secret set ${missingCodespaces[0] ?? "NAME"} --app codespaces --repo ${repo}, then re-check.`
					: missingDependabot.length > 0
						? `Add values with e.g. gh secret set ${missingDependabot[0] ?? "NAME"} --app dependabot --repo ${repo}, then re-check.`
						: missingEnv.length > 0
							? `Add values with e.g. gh secret set NAME --env ${firstEnv} --repo ${repo}, then re-check.`
							: missingSecrets.length > 0
								? `Add values with e.g. gh secret set ${missingSecrets[0] ?? "NAME"} --repo ${repo}, then re-check.`
								: `Add values with e.g. gh variable set ${missingVariables[0] ?? "NAME"} --repo ${repo}, then re-check.`,
	);
}
