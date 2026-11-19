import type { CheckBase, CheckResult, OverwriteFileFix } from "#/core/result.js";
import { checkBase, failFixable, failManual, pass } from "#/core/result.js";
import { UPSTREAM_FETCH_CONCURRENCY } from "#/core/upstream/remote.js";
import { mapWithConcurrency } from "#/utils/concurrency.js";
import { errorMessage } from "#/utils/error.js";

// Rendered files hold decrypted secrets: without a declared mode they are
// written and enforced owner-only.
const DEFAULT_SECRETS_MODE = "0600";

const SECRET_PATTERN = /\$\$[A-Z][A-Z0-9_]*\$\$/gu;

// Replaces $$NAME$$ slots with the given values (names used as-is, CAPITAL_CASING).
// Slots without a value stay in place and are reported as leftovers, so unresolved
// placeholders never pass as clean.
export function renderSecretsTemplate(
	sourceText: string,
	values: Record<string, string>,
): { leftover: string[]; text: string } {
	let text = sourceText;
	for (const [name, value] of Object.entries(values)) {
		// Replacer function: `$` sequences in secret values stay literal.
		text = text.replaceAll(`$$${name}$$`, () => value);
	}
	return { leftover: [...new Set(text.match(SECRET_PATTERN) ?? [])], text };
}

interface SecretsTemplate {
	mode?: string;
	name: string;
	// Only these secrets are substituted; the rest of secrets.yaml never reaches the file.
	secrets: string[];
	source: string;
	// Absolute (already resolved against $HOME).
	target: string;
}

export interface SecretsTemplateTarget {
	exists: boolean;
	mode?: string;
	text?: string;
}

interface CheckSecretsTemplatesArgs {
	blueprint: string;
	decryptSecrets: () => Promise<Record<string, string>>;
	fetchSource: (source: string) => Promise<string>;
	readTarget: (path: string) => Promise<SecretsTemplateTarget>;
	// check --skip-secrets: match structure only, never decrypt.
	skipSecrets?: boolean;
	templates: SecretsTemplate[];
}

type Secrets = { error: string; values?: undefined } | { values: Record<string, string> };

type Observed =
	| { error: string; kind: "source" }
	| { error: string; kind: "target" }
	| { kind: "ok"; live: SecretsTemplateTarget; sourceText: string };

function templateBase(blueprint: string, template: SecretsTemplate): CheckBase {
	return checkBase("machine", blueprint, `secrets-template:${template.name}`, template.target);
}

// Live modes come from stat as "600", blueprints say "0600": compare the
// zero-stripped forms so identical modes do not flag.
function normalizeMode(mode: string): string {
	const stripped = mode.replace(/^0+/u, "");
	return stripped === "" ? "0" : stripped;
}

// Rendered and live text hold decrypted secrets: keep them out of reports.
function redacted(text: string): string {
	return `<redacted: ${text.length} chars with secrets>`;
}

// --skip-secrets: every $$NAME$$ slot matches any value, so structure is
// checked without decrypting. Literals are escaped, slots become non-greedy.
function templateStructurePattern(sourceText: string): RegExp {
	const literals = sourceText
		.split(SECRET_PATTERN)
		.map((part) => part.replaceAll(/([.*+?^${}()|[\]\\])/gu, "\\$1"));
	return new RegExp(`^${literals.join(".*?")}$`, "su");
}

function skipSecretsResult(
	blueprint: string,
	template: SecretsTemplate,
	observed: Observed,
): CheckResult {
	const base = templateBase(blueprint, template);
	if (observed.kind === "target") {
		return failManual(
			base,
			"<unreadable>",
			template.source,
			`Cannot read ${template.target}: ${observed.error}`,
		);
	}
	if (observed.kind === "source") {
		return failManual(
			base,
			"<blueprint fetch failed>",
			template.source,
			`Cannot fetch blueprint file ${template.source}: ${observed.error}; fix the network or blueprint, then re-check.`,
		);
	}
	const { live } = observed;
	if (!live.exists) {
		return failManual(
			base,
			"<missing>",
			"secrets template target exists (--skip-secrets)",
			`${template.target} is missing; re-run check without --skip-secrets for the fixable diff.`,
		);
	}
	if (live.text === undefined) {
		return failManual(
			base,
			"<not a regular file>",
			"secrets template target exists (--skip-secrets)",
			`${template.target} is not a regular file; move it aside, then re-check.`,
		);
	}
	const mode = template.mode ?? DEFAULT_SECRETS_MODE;
	const modeMismatch = live.mode !== undefined && normalizeMode(live.mode) !== normalizeMode(mode);
	if (!templateStructurePattern(observed.sourceText).test(live.text)) {
		const outcome = failManual(
			base,
			redacted(live.text),
			"matches secrets template structure (secrets skipped)",
			`${template.target} does not match ${template.source} structure (secrets skipped); re-run check without --skip-secrets for the fixable diff.`,
		);
		if (modeMismatch) {
			outcome.hint += ` Mode is ${live.mode ?? "<unknown>"}, want ${mode}.`;
		}
		return outcome;
	}
	if (modeMismatch) {
		return failManual(
			base,
			redacted(live.text),
			"matches secrets template structure (secrets skipped)",
			`Mode is ${live.mode ?? "<unknown>"}, want ${mode}: chmod ${mode} ${template.target} or re-run check without --skip-secrets to fix, then re-check.`,
		);
	}
	return pass(
		base,
		"matches secrets template structure (secrets skipped)",
		`rendered ${template.source}`,
	);
}

function templateResult(
	blueprint: string,
	template: SecretsTemplate,
	observed: Observed,
	secrets: Secrets,
): CheckResult {
	const base = templateBase(blueprint, template);
	if (observed.kind === "target") {
		return failManual(
			base,
			"<unreadable>",
			template.source,
			`Cannot read ${template.target}: ${observed.error}`,
		);
	}
	if (observed.kind === "source") {
		return failManual(
			base,
			"<blueprint fetch failed>",
			template.source,
			`Cannot fetch blueprint file ${template.source}: ${observed.error}; fix the network or blueprint, then re-check.`,
		);
	}
	if (secrets.values === undefined) {
		return failManual(
			base,
			"<secrets unavailable>",
			`rendered ${template.source}`,
			`Cannot decrypt secrets: ${secrets.error}; make sops --decrypt work (missing sops or age key?), then re-check.`,
		);
	}
	const { values } = secrets;
	const undeclared = template.secrets.filter((name) => !Object.hasOwn(values, name));
	if (undeclared.length > 0) {
		return failManual(
			base,
			`<secrets missing: ${undeclared.join(", ")}>`,
			`rendered ${template.source}`,
			`Add ${undeclared.join(", ")} to the machine's secrets.yaml, then re-check.`,
		);
	}
	const rendered = renderSecretsTemplate(
		observed.sourceText,
		Object.fromEntries(template.secrets.map((name) => [name, values[name] as string])),
	);
	if (rendered.leftover.length > 0) {
		return failManual(
			base,
			`contains placeholders: ${rendered.leftover.join(", ")}`,
			"rendered secrets template (no $$PLACEHOLDER$$ slots)",
			`Declare ${rendered.leftover.join(", ")} in the file's secrets list (and secrets.yaml), then re-check.`,
		);
	}
	const mode = template.mode ?? DEFAULT_SECRETS_MODE;
	const fix: OverwriteFileFix = {
		filePath: template.target,
		kind: "overwrite-file",
		mode,
		newContent: rendered.text,
		secret: true,
	};
	const { live } = observed;
	if (!live.exists) {
		return failFixable(base, "<missing>", "rendered secrets template", fix);
	}
	if (live.text === undefined) {
		return failManual(
			base,
			"<not a regular file>",
			"rendered secrets template",
			`${template.target} is not a regular file; move it aside, then re-check.`,
		);
	}
	const modeMismatch = live.mode !== undefined && normalizeMode(live.mode) !== normalizeMode(mode);
	if (live.text !== rendered.text || modeMismatch) {
		const outcome = failFixable(base, redacted(live.text), redacted(rendered.text), fix);
		if (modeMismatch) {
			outcome.hint = `Mode is ${live.mode ?? "<unknown>"}, want ${mode}: fix rewrites the file with mode ${mode}.`;
		}
		return outcome;
	}
	return pass(base, "matches rendered secrets template", `rendered ${template.source}`);
}

async function observe(
	args: CheckSecretsTemplatesArgs,
	template: SecretsTemplate,
): Promise<Observed> {
	let live: SecretsTemplateTarget;
	try {
		live = await args.readTarget(template.target);
	} catch (error) {
		return { error: errorMessage(error), kind: "target" };
	}
	try {
		return { kind: "ok", live, sourceText: await args.fetchSource(template.source) };
	} catch (error) {
		return { error: errorMessage(error), kind: "source" };
	}
}

export async function checkSecretsTemplates(
	args: CheckSecretsTemplatesArgs,
): Promise<CheckResult[]> {
	if (args.templates.length === 0) {
		return [];
	}
	// --skip-secrets never decrypts (no sops/age key needed); structure only.
	if (args.skipSecrets === true) {
		const observed = await mapWithConcurrency(
			args.templates,
			UPSTREAM_FETCH_CONCURRENCY,
			(template) => observe(args, template),
		);
		return args.templates.map((template, index) =>
			skipSecretsResult(args.blueprint, template, observed[index] as Observed),
		);
	}
	// One decrypt per run, shared by every template; failures keep their cause.
	const secretsTask = args.decryptSecrets().then(
		(values): Secrets => ({ values }),
		(error: unknown): Secrets => ({ error: errorMessage(error) }),
	);
	const observed = await mapWithConcurrency(
		args.templates,
		UPSTREAM_FETCH_CONCURRENCY,
		(template) => observe(args, template),
	);
	const secrets = await secretsTask;
	return args.templates.map((template, index) =>
		templateResult(args.blueprint, template, observed[index] as Observed, secrets),
	);
}
