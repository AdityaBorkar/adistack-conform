import { apiJsonPaged, isAuthError, repoPath } from "#/core/github/api.js";
import type { GithubSettings } from "#/core/github/shared.js";
import type { CheckResult, GithubApiFix, GithubApiStep } from "#/core/result.js";
import { checkBase, failFixable, pass, skipped } from "#/core/result.js";

interface WebhookState {
	active?: unknown;
	config?: { content_type?: unknown; insecure_ssl?: unknown; url?: unknown };
	events?: unknown;
	id?: unknown;
}

function eventNames(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map(String).toSorted();
}

// Declared webhooks are enforced (matched by payload URL); undeclared hooks
// are ignored. Secrets are write-only in the API, so they stay manual.
export async function checkWebhooks(
	blueprint: string,
	repo: string,
	upstream: GithubSettings,
	target: string,
): Promise<CheckResult> {
	const base = checkBase("github", blueprint, "webhooks", target);
	const hooks = upstream.webhooks;
	if (hooks.length === 0) {
		return pass(base, "no webhooks required", "webhooks match");
	}
	let current: WebhookState[];
	try {
		current = (await apiJsonPaged(repoPath(repo, "/hooks"))) as WebhookState[];
	} catch (error) {
		if (isAuthError(error)) {
			return skipped(base, "cannot list webhooks", "set GITHUB_TOKEN (private repo or rate limit)");
		}
		throw error;
	}
	const diffs: string[] = [];
	const steps: GithubApiStep[] = [];
	for (const want of hooks) {
		const found = current.find((hook) => hook.config?.url === want.url);
		const config = {
			content_type: want.content_type,
			...(want.insecure_ssl === undefined ? {} : { insecure_ssl: want.insecure_ssl ? "1" : "0" }),
			url: want.url,
		};
		if (found === undefined) {
			diffs.push(`missing: ${want.url}`);
			steps.push({
				body: {
					active: want.active,
					config,
					events: want.events,
					name: "web",
				},
				method: "POST",
				path: repoPath(repo, "/hooks"),
			});
			continue;
		}
		const hookDiffs: string[] = [];
		const haveEvents = eventNames(found.events);
		if (JSON.stringify(haveEvents) !== JSON.stringify([...want.events].toSorted())) {
			hookDiffs.push(`events: ${haveEvents.join(", ") || "<none>"} → ${want.events.join(", ")}`);
		}
		if (!Object.is(found.active, want.active)) {
			hookDiffs.push(`active: ${String(found.active)} → ${String(want.active)}`);
		}
		if (found.config?.content_type !== want.content_type) {
			hookDiffs.push(`content_type: ${String(found.config?.content_type)} → ${want.content_type}`);
		}
		if (
			config.insecure_ssl !== undefined &&
			String(found.config?.insecure_ssl) !== config.insecure_ssl
		) {
			hookDiffs.push(
				`insecure_ssl: ${String(found.config?.insecure_ssl)} → ${config.insecure_ssl}`,
			);
		}
		if (hookDiffs.length > 0) {
			diffs.push(`${want.url} (${hookDiffs.join("; ")})`);
			steps.push({
				body: {
					active: want.active,
					config,
					events: want.events,
				},
				method: "PATCH",
				path: repoPath(repo, `/hooks/${String(found.id)}`),
			});
		}
	}
	if (diffs.length === 0) {
		return pass(base, `webhooks: ${hooks.map((hook) => hook.url).join(", ")}`, "webhooks match");
	}
	const fix: GithubApiFix = { kind: "github-api", label: `github webhooks ${repo}`, steps };
	return failFixable(base, diffs.join("; "), "webhooks match", fix);
}
