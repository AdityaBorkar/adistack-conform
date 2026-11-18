import { ApiError, apiJson, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass, skipped } from "#/core/result.js";

// Access → Collaborators & teams (/settings/access). Declared entries are
// enforced; extras are ignored (like webhooks). Collaborator permission is
// read per-user; team permission via the org Teams API.
export async function checkAccess(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "access", target);
	const wantCollaborators = upstream.access?.collaborators ?? [];
	const wantTeams = upstream.access?.teams ?? [];
	if (wantCollaborators.length === 0 && wantTeams.length === 0) {
		return pass(base, "no collaborators/teams required", "access match");
	}
	const [owner, name] = repo.split("/");
	const teamPath = (slug: string): string =>
		`/orgs/${encodeURIComponent(owner ?? "")}/teams/${encodeURIComponent(slug)}/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(name ?? "")}`;
	async function teamPermission(slug: string): Promise<string> {
		try {
			const perm = (await apiJson(teamPath(slug))) as { permission?: unknown };
			return typeof perm?.permission === "string" ? perm.permission : "<none>";
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) {
				return "<none>";
			}
			throw error;
		}
	}
	const diffs: string[] = [];
	const steps: GithubApiStep[] = [];
	try {
		const collaboratorResults = await Promise.all(
			wantCollaborators.map(async (want) => {
				const perm = (await apiJson(
					repoPath(repo, `/collaborators/${encodeURIComponent(want.login)}/permission`),
					{ allowStatuses: [404] },
				)) as { permission?: unknown } | undefined;
				const have = typeof perm?.permission === "string" ? perm.permission : "<none>";
				return { have, want };
			}),
		);
		const teamResults = await Promise.all(
			wantTeams.map(async (want) => ({ have: await teamPermission(want.slug), want })),
		);
		for (const { have, want } of collaboratorResults) {
			if (have !== want.permission) {
				diffs.push(`collaborator ${want.login}: ${have} → ${want.permission}`);
				steps.push({
					body: { permission: want.permission },
					method: "PUT",
					path: repoPath(repo, `/collaborators/${encodeURIComponent(want.login)}`),
				});
			}
		}
		for (const { have, want } of teamResults) {
			if (have !== want.permission) {
				diffs.push(`team ${want.slug}: ${have} → ${want.permission}`);
				steps.push({
					body: { permission: want.permission },
					method: "PUT",
					path: teamPath(want.slug),
				});
			}
		}
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read access list",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	if (diffs.length === 0) {
		return pass(base, "collaborators/teams match", "access match");
	}
	const fix: GithubApiFix = { kind: "github-api", label: `github PUT ${repo} access`, steps };
	return failFixable(base, diffs.join("; "), "access match", fix);
}

// Access → Moderation → Interaction limits (/settings/interaction_limits).
// Time-boxed abuse response: check via API, fix is manual in the UI.
export async function checkInteractionLimits(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "access-limits", target);
	const want = upstream.interactionLimits;
	if (want === undefined) {
		return pass(base, "no interaction limits required", "interaction limits match");
	}
	let have = "off";
	try {
		const current = (await apiJson(repoPath(repo, "/interaction-limits"), {
			allowStatuses: [404],
		})) as { limit?: unknown } | undefined;
		if (typeof current?.limit === "string") {
			have = current.limit;
		}
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot read interaction limits",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	if (have === want.limit) {
		return pass(base, `interaction limits: ${have}`, "interaction limits match");
	}
	return failManual(
		base,
		`interaction limits: ${have} → ${want.limit}`,
		"interaction limits match",
		`Set Interaction limits to ${want.limit} in Settings → Moderation, then re-check (time-boxed; not auto-fixed).`,
	);
}

export async function checkRequiredWorkflows(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "required-workflows", target);
	const want = upstream.requiredWorkflows ?? [];
	if (want.length === 0) {
		return pass(base, "no required workflows", "required workflows match");
	}
	let have: string[] = [];
	try {
		const items = (await apiJson(repoPath(repo, "/required_workflows"), {
			allowStatuses: [404],
		})) as Array<{ path?: unknown }> | undefined;
		if (Array.isArray(items)) {
			have = items.map((entry) => String(entry.path ?? ""));
		}
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(
				base,
				"cannot list required workflows",
				"set GITHUB_TOKEN (private repo or rate limit)",
			);
		}
		throw error;
	}
	const missing = want.filter((path) => !have.includes(path));
	if (missing.length === 0) {
		return pass(base, `required workflows: ${want.join(", ")}`, "required workflows match");
	}
	return failManual(
		base,
		`missing: ${missing.join(", ")}`,
		`required workflows: ${want.join(", ")}`,
		`Author required workflow file(s) ${missing.join(", ")} at org level, then re-check.`,
	);
}
