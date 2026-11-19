import { describe, expect, test } from "bun:test";

import { checkSecretsTemplates, renderSecretsTemplate } from "#/core/machine/templates.js";

const blueprint = "main";

describe("renderSecretsTemplate", () => {
	test("substitutes values and reports leftovers", () => {
		expect(
			renderSecretsTemplate("token=$$NPM_AUTH_TOKEN$$\n", { NPM_AUTH_TOKEN: "s3cr3t" }),
		).toEqual({
			leftover: [],
			text: "token=s3cr3t\n",
		});
		expect(renderSecretsTemplate("$$A$$ and $$B$$\n", { A: "1" })).toEqual({
			leftover: ["$$B$$"],
			text: "1 and $$B$$\n",
		});
		expect(renderSecretsTemplate("token=$$NPM_TOKEN$$\n", { NPM_TOKEN: "t" })).toEqual({
			leftover: [],
			text: "token=t\n",
		});
	});
	test("dollar sequences in values stay literal", () => {
		expect(renderSecretsTemplate("token=$$TOKEN$$\n", { TOKEN: "$1 $$ $&" })).toEqual({
			leftover: [],
			text: "token=$1 $$ $&\n",
		});
	});
});

describe("checkSecretsTemplates", () => {
	const template = {
		mode: "0600",
		name: "Npmrc",
		secrets: ["NPM_AUTH_TOKEN"],
		source: "machines/main/files/.npmrc",
		target: "/home/ada/.npmrc",
	};

	test("undecryptable secrets fail manual with the cause", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.reject(new Error("sops: age key missing")),
			fetchSource: () => Promise.resolve("token=$$NPM_AUTH_TOKEN$$\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "0600", text: "token=x\n" }),
			templates: [template],
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:secrets-template:Npmrc");
		expect(results[0]?.scope).toBe("machine");
		expect(results[0]?.upstream).toBe("tech-stack:main");
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toMatch(/sops|age/iu);
		expect(results[0]?.hint).toContain("age key missing");
	});

	test("no templates means no decrypt", async () => {
		let decryptCalls = 0;
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => {
				decryptCalls += 1;
				return Promise.resolve({});
			},
			fetchSource: () => Promise.resolve(""),
			readTarget: () => Promise.resolve({ exists: false }),
			templates: [],
		});
		expect(results).toEqual([]);
		expect(decryptCalls).toBe(0);
	});

	test("only declared secrets are substituted", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({ NPM_AUTH_TOKEN: "t", OTHER: "leaked" }),
			fetchSource: () => Promise.resolve("token=$$NPM_AUTH_TOKEN$$\nother=$$OTHER$$\n"),
			readTarget: () => Promise.resolve({ exists: false }),
			templates: [template],
		});
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.actual).toContain("$$OTHER$$");
		expect(JSON.stringify(results)).not.toContain("leaked");
	});

	test("a declared secret missing from secrets.yaml fails manual", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({}),
			fetchSource: () => Promise.resolve("token=$$NPM_AUTH_TOKEN$$\n"),
			readTarget: () => Promise.resolve({ exists: false }),
			templates: [template],
		});
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.actual).toContain("NPM_AUTH_TOKEN");
		expect(results[0]?.hint).toContain("secrets.yaml");
	});

	test("without a declared mode the file is written and enforced 0600", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({ NPM_AUTH_TOKEN: "t" }),
			fetchSource: () => Promise.resolve("token=$$NPM_AUTH_TOKEN$$\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "644", text: "token=t\n" }),
			templates: [{ ...template, mode: undefined }],
		});
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toMatchObject({ kind: "overwrite-file", mode: "0600", secret: true });
		expect(results[0]?.hint).toContain("mode 0600");
	});

	test("matching content and mode passes", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({ NPM_AUTH_TOKEN: "t" }),
			fetchSource: () => Promise.resolve("token=$$NPM_AUTH_TOKEN$$\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "600", text: "token=t\n" }),
			templates: [template],
		});
		expect(results[0]?.ok).toBe(true);
	});

	test("drift never exposes the secret in actual/expected", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({ TOKEN: "s3cr3t-new" }),
			fetchSource: () => Promise.resolve("token=$$TOKEN$$\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "600", text: "token=s3cr3t-old\n" }),
			templates: [{ ...template, secrets: ["TOKEN"] }],
		});
		const [result] = results;
		expect(result?.ok).toBe(false);
		expect(`${result?.actual} ${result?.expected}`).not.toContain("s3cr3t");
		expect(result?.fix).toMatchObject({ newContent: "token=s3cr3t-new\n", secret: true });
	});

	test("unfetchable source fails manual with the cause", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({}),
			fetchSource: () => Promise.reject(new Error("net down")),
			readTarget: () => Promise.resolve({ exists: false }),
			templates: [template],
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toContain("net down");
	});
});

describe("checkSecretsTemplates --skip-secrets", () => {
	const template = {
		mode: "0600",
		name: "Npmrc",
		secrets: ["NPM_AUTH_TOKEN"],
		source: "machines/main/files/.npmrc",
		target: "/home/ada/.npmrc",
	};

	function skipArgs(
		overrides: Partial<Parameters<typeof checkSecretsTemplates>[0]> = {},
	): Parameters<typeof checkSecretsTemplates>[0] {
		return {
			blueprint,
			// Must never run: structure-only checks need no sops/age key.
			decryptSecrets: () => Promise.reject(new Error("must not decrypt")),
			fetchSource: () => Promise.resolve("token=$$NPM_AUTH_TOKEN$$\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "600", text: "token=anything\n" }),
			skipSecrets: true,
			templates: [template],
			...overrides,
		};
	}

	test("structure match passes without decrypting", async () => {
		const results = await checkSecretsTemplates(skipArgs());
		expect(results[0]?.ok).toBe(true);
		expect(results[0]?.fix).toBeUndefined();
	});

	test("structure mismatch is manual without a fix", async () => {
		const results = await checkSecretsTemplates(
			skipArgs({
				readTarget: () => Promise.resolve({ exists: true, mode: "600", text: "other=x\n" }),
			}),
		);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(`${results[0]?.actual} ${results[0]?.expected}`).not.toContain("other=x");
		expect(results[0]?.hint).toContain("--skip-secrets");
	});

	test("missing target and mode mismatch are manual", async () => {
		const [missing] = await checkSecretsTemplates(
			skipArgs({ readTarget: () => Promise.resolve({ exists: false }) }),
		);
		expect(missing?.ok).toBe(false);
		expect(missing?.fix).toBeUndefined();
		expect(missing?.hint).toContain("--skip-secrets");

		const [mode] = await checkSecretsTemplates(
			skipArgs({
				readTarget: () => Promise.resolve({ exists: true, mode: "644", text: "token=t\n" }),
			}),
		);
		expect(mode?.ok).toBe(false);
		expect(mode?.fix).toBeUndefined();
		expect(mode?.hint).toContain("0600");
	});

	test("template literals match exactly, slots match anything", async () => {
		const args = skipArgs({
			fetchSource: () => Promise.resolve("[a.b]\nkey=$$TOKEN$$\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "600", text: "[aXb]\nkey=v\n" }),
		});
		const [escaped] = await checkSecretsTemplates(args);
		expect(escaped?.ok).toBe(false);
	});
});
