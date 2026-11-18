import { ApiError, apiJson, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import { fixOrPass, skipOnError } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/core/result.js";
import { checkBase, failFixable, pass, skipped } from "#/core/result.js";

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
// GET returns {} when off; fix is PUT {limit, expiry} or DELETE for "off".
// Only `limit` is compared: the live expiry is a timestamp, not a duration.
export async function checkInteractionLimits(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult | undefined> {
	const want = upstream.access?.moderation?.interaction_limits;
	if (want === undefined) {
		return undefined;
	}
	const base = checkBase("github", blueprint, "access-limits", target);
	let have = "off";
	try {
		const current = (await apiJson(repoPath(repo, "/interaction-limits"), {
			allowStatuses: [404],
		})) as { limit?: unknown } | undefined;
		if (typeof current?.limit === "string") {
			have = current.limit;
		}
	} catch (error) {
		return skipOnError(error, base, "interaction limits");
	}
	const path = repoPath(repo, "/interaction-limits");
	const step: GithubApiStep =
		want.limit === "off"
			? { method: "DELETE", path }
			: { body: { expiry: want.expiry, limit: want.limit }, method: "PUT", path };
	return fixOrPass(
		base,
		have === want.limit ? [] : [`interaction limits: ${have} → ${want.limit}`],
		[step],
		`github ${step.method} ${repo} interaction-limits`,
		`interaction limits: ${want.limit}`,
	);
}
