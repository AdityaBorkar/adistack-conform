import type { CheckBase, CheckResult, OverwriteFileFix } from "#/core/result.js";
import { failFixable, failManual, pass } from "#/core/result.js";
import { UPSTREAM_FETCH_CONCURRENCY } from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

export interface RenderedTemplate {
	leftover: string[];
	text: string;
}

const LEFTOVER_PATTERN = /@@[^@\s]+@@/gu;

// Replaces @@NAME@@ slots with secret values (secret names are used as-is;
// the SPEC example secret `npm_auth_token` is lowercase). Slots without a
// matching secret stay in place; leftover reports any remaining @@...@@
// slot so unresolved placeholders never pass as clean.
export function renderTemplate(
	sourceText: string,
	secrets: Record<string, string>,
): RenderedTemplate {
	let text = sourceText;
	for (const [name, value] of Object.entries(secrets)) {
		if (name === "") {
			continue;
		}
		text = text.replaceAll(`@@${name}@@`, value);
	}
	return { leftover: [...new Set(text.match(LEFTOVER_PATTERN) ?? [])], text };
}

export interface MachineTemplate {
	mode?: string;
	name: string;
	secrets?: string[];
	source: string;
	target: string;
}

export interface TemplateTarget {
	exists: boolean;
	mode?: string;
	text?: string;
}

export interface CheckTemplatesArgs {
	blueprint: string;
	decryptSecrets: () => Promise<Record<string, string>>;
	fetchSource: (source: string) => Promise<string | null>;
	readTarget: (path: string) => Promise<TemplateTarget>;
	templates: MachineTemplate[];
}

interface TemplateObservation {
	error?: string;
	exists: boolean;
	mode?: string;
	text?: string;
}

function templateBase(blueprint: string, template: MachineTemplate): CheckBase {
	return {
		id: `machine:${blueprint}:template:${template.name}`,
		kind: "machine",
		scope: "machine",
		target: template.target,
		upstream: `tech-stack:${blueprint}`,
	};
}

// Live modes come from stat as "600", blueprints say "0600": compare the
// zero-stripped forms so identical modes do not flag.
function normalizeMode(mode: string): string {
	const stripped = mode.replace(/^0+/u, "");
	return stripped === "" ? "0" : stripped;
}

function templateResult(
	blueprint: string,
	template: MachineTemplate,
	sourceText: string | null,
	sourceError: string,
	live: TemplateObservation,
	secrets: Record<string, string> | null,
	secretsError: string,
): CheckResult {
	const base = templateBase(blueprint, template);
	if (live.error !== undefined) {
		return failManual(
			base,
			"<unreadable>",
			template.source,
			`Cannot read ${template.target}: ${live.error}`,
		);
	}
	if (sourceText === null) {
		const detail = sourceError === "" ? "" : `: ${sourceError}`;
		return failManual(
			base,
			"<blueprint fetch failed>",
			template.source,
			`Cannot fetch blueprint file ${template.source}${detail}; fix the network or blueprint, then re-check.`,
		);
	}
	if ((template.secrets?.length ?? 0) > 0 && secrets === null) {
		const detail = secretsError === "" ? "" : `: ${secretsError}`;
		return failManual(
			base,
			"<secrets unavailable>",
			`rendered ${template.source}`,
			`Cannot decrypt secrets${detail}; make sops --decrypt work (missing sops or age key?), then re-check.`,
		);
	}
	const rendered = renderTemplate(sourceText, secrets ?? {});
	if (rendered.leftover.length > 0) {
		return failManual(
			base,
			`contains placeholders: ${rendered.leftover.join(", ")}`,
			"rendered template (no @@PLACEHOLDER@@ slots)",
			`Provide values for ${rendered.leftover.join(", ")} via sops secrets, then re-check.`,
		);
	}
	const hasSecrets = (template.secrets?.length ?? 0) > 0;
	// Rendered and live text hold decrypted secrets: keep them out of reports.
	const shown = (text: string): string =>
		hasSecrets ? `<redacted: ${text.length} chars with secrets>` : text;
	const fix: OverwriteFileFix = {
		filePath: template.target,
		kind: "overwrite-file",
		mode: template.mode,
		newContent: rendered.text,
		...(hasSecrets ? { secret: true } : {}),
	};
	if (!live.exists) {
		return failFixable(base, "<missing>", "rendered template", fix);
	}
	if (live.text === undefined) {
		return failManual(
			base,
			"<not a regular file>",
			"rendered template",
			`${template.target} is not a regular file; move it aside, then re-check.`,
		);
	}
	const modeMismatch =
		template.mode !== undefined &&
		live.mode !== undefined &&
		normalizeMode(live.mode) !== normalizeMode(template.mode);
	if (live.text !== rendered.text || modeMismatch) {
		const outcome = failFixable(base, shown(live.text), shown(rendered.text), fix);
		if (modeMismatch) {
			outcome.hint = `Mode is ${live.mode ?? "<unknown>"}, want ${template.mode}: fix rewrites the file with mode ${template.mode}.`;
		}
		return outcome;
	}
	return pass(base, "matches rendered template", `rendered ${template.source}`);
}

export async function checkTemplates(args: CheckTemplatesArgs): Promise<CheckResult[]> {
	const needsSecrets = args.templates.some((template) => (template.secrets?.length ?? 0) > 0);
	// One decrypt per run, shared by every template. Failures keep their
	// cause so the manual hint says why instead of a generic nudge.
	const secretsTask = needsSecrets
		? args.decryptSecrets().then(
				(secrets) => ({ secrets, secretsError: "" }),
				(error: unknown) => ({
					secrets: null as Record<string, string> | null,
					secretsError: errorMessage(error),
				}),
			)
		: Promise.resolve({ secrets: {} as Record<string, string>, secretsError: "" });
	const rows = await mapWithConcurrency(
		args.templates,
		UPSTREAM_FETCH_CONCURRENCY,
		async (template) => {
			let sourceText: string | null = null;
			let sourceError = "";
			try {
				sourceText = await args.fetchSource(template.source);
			} catch (error) {
				sourceError = errorMessage(error);
			}
			let live: TemplateObservation;
			try {
				live = await args.readTarget(template.target);
			} catch (error) {
				live = { error: errorMessage(error), exists: false };
			}
			return { live, sourceError, sourceText, template };
		},
	);
	const { secrets, secretsError } = await secretsTask;
	return rows.map((row) =>
		templateResult(
			args.blueprint,
			row.template,
			row.sourceText,
			row.sourceError,
			row.live,
			secrets,
			secretsError,
		),
	);
}
