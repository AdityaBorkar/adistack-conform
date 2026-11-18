import { describe, expect, test } from "bun:test";

import { checkSecretsTemplates, renderSecretsTemplate } from "#/core/machine/templates.js";

const blueprint = "main";

describe("renderSecretsTemplate", () => {
	test("substitutes values and reports leftovers", () => {
		expect(
			renderSecretsTemplate("token=@@npm_auth_token@@\n", { npm_auth_token: "s3cr3t" }),
		).toEqual({
			leftover: [],
			text: "token=s3cr3t\n",
		});
		expect(renderSecretsTemplate("@@A@@ and @@B@@\n", { A: "1" })).toEqual({
			leftover: ["@@B@@"],
			text: "1 and @@B@@\n",
		});
		expect(renderSecretsTemplate("token=@@npm-token@@\n", { "npm-token": "t" })).toEqual({
			leftover: [],
			text: "token=t\n",
		});
	});
});

describe("checkSecretsTemplates", () => {
	const template = {
		mode: "0600",
		name: "Npmrc",
		secrets: ["npm_auth_token"],
		source: "machines/main/files/.npmrc",
		target: "/home/ada/.npmrc",
	};

	test("undecryptable secrets fail manual with the cause", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.reject(new Error("sops: age key missing")),
			fetchSource: () => Promise.resolve("token=@@npm_auth_token@@\n"),
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
			decryptSecrets: () => Promise.resolve({ OTHER: "leaked", npm_auth_token: "t" }),
			fetchSource: () => Promise.resolve("token=@@npm_auth_token@@\nother=@@OTHER@@\n"),
			readTarget: () => Promise.resolve({ exists: false }),
			templates: [template],
		});
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.actual).toContain("@@OTHER@@");
		expect(JSON.stringify(results)).not.toContain("leaked");
	});

	test("a declared secret missing from secrets.yaml fails manual", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({}),
			fetchSource: () => Promise.resolve("token=@@npm_auth_token@@\n"),
			readTarget: () => Promise.resolve({ exists: false }),
			templates: [template],
		});
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.actual).toContain("npm_auth_token");
		expect(results[0]?.hint).toContain("secrets.yaml");
	});

	test("without a declared mode the file is written and enforced 0600", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({ npm_auth_token: "t" }),
			fetchSource: () => Promise.resolve("token=@@npm_auth_token@@\n"),
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
			decryptSecrets: () => Promise.resolve({ npm_auth_token: "t" }),
			fetchSource: () => Promise.resolve("token=@@npm_auth_token@@\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "600", text: "token=t\n" }),
			templates: [template],
		});
		expect(results[0]?.ok).toBe(true);
	});

	test("drift never exposes the secret in actual/expected", async () => {
		const results = await checkSecretsTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({ TOKEN: "s3cr3t-new" }),
			fetchSource: () => Promise.resolve("token=@@TOKEN@@\n"),
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
