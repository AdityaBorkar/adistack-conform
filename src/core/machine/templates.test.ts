import { describe, expect, test } from "bun:test";

import { checkTemplates, renderTemplate } from "#/core/machine/templates.js";

const blueprint = "main";

describe("renderTemplate", () => {
	test("substitutes secrets and reports leftovers", () => {
		expect(renderTemplate("token=@@npm_auth_token@@\n", { npm_auth_token: "s3cr3t" })).toEqual({
			leftover: [],
			text: "token=s3cr3t\n",
		});
		expect(renderTemplate("@@A@@ and @@B@@\n", { A: "1" })).toEqual({
			leftover: ["@@B@@"],
			text: "1 and @@B@@\n",
		});
		expect(renderTemplate("token=@@npm_auth_token@@\n", {})).toEqual({
			leftover: ["@@npm_auth_token@@"],
			text: "token=@@npm_auth_token@@\n",
		});
	});
});

describe("checkTemplates", () => {
	const template = {
		mode: "0600",
		name: "Npmrc",
		secrets: ["npm_auth_token"],
		source: "machines/main/files/.npmrc",
		target: "/home/ada/.npmrc",
	};

	test("undecryptable secrets fail manual with the cause", async () => {
		const results = await checkTemplates({
			blueprint,
			decryptSecrets: () => Promise.reject(new Error("sops: age key missing")),
			fetchSource: () => Promise.resolve("token=@@npm_auth_token@@\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "0600", text: "token=x\n" }),
			templates: [template],
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("machine:main:template:Npmrc");
		expect(results[0]?.scope).toBe("machine");
		expect(results[0]?.upstream).toBe("tech-stack:main");
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.hint).toMatch(/sops|age/iu);
		expect(results[0]?.hint).toContain("age key missing");
	});

	test("mode drift is fixable without calling decrypt for secretless templates", async () => {
		let decryptCalls = 0;
		const results = await checkTemplates({
			blueprint,
			decryptSecrets: () => {
				decryptCalls += 1;
				return Promise.resolve({});
			},
			fetchSource: () => Promise.resolve("a=1\n"),
			readTarget: () => Promise.resolve({ exists: true, mode: "0644", text: "a=1\n" }),
			templates: [
				{
					mode: "0600",
					name: "Mode",
					secrets: [],
					source: "machines/main/files/.npmrc",
					target: "/home/ada/.npmrc",
				},
			],
		});
		expect(decryptCalls).toBe(0);
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toEqual({
			filePath: "/home/ada/.npmrc",
			kind: "overwrite-file",
			newContent: "a=1\n",
		});
		expect(results[0]?.hint).toContain("chmod 0600");
	});

	test("leftover placeholders fail manual", async () => {
		const results = await checkTemplates({
			blueprint,
			decryptSecrets: () => Promise.resolve({}),
			fetchSource: () => Promise.resolve("token=@@NPM_AUTH_TOKEN@@\n"),
			readTarget: () => Promise.resolve({ exists: false }),
			templates: [
				{
					mode: "0600",
					name: "Leftover",
					secrets: ["NPM_AUTH_TOKEN"],
					source: "machines/main/files/.npmrc",
					target: "/home/ada/.npmrc",
				},
			],
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.fix).toBeUndefined();
		expect(results[0]?.actual).toContain("@@NPM_AUTH_TOKEN@@");
	});

	test("unfetchable source fails manual with the cause", async () => {
		const results = await checkTemplates({
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
