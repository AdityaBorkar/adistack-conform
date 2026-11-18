import { afterEach, describe, expect, test } from "bun:test";

import { FetchError, fetchOkResponse, pinnedReader } from "#/core/upstream/remote.js";
import { UpstreamMissingError } from "#/core/upstream/tech-stack.js";

const originalFetch = globalThis.fetch;
const originalToken = process.env["GITHUB_TOKEN"];

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalToken === undefined) {
		delete process.env["GITHUB_TOKEN"];
	} else {
		process.env["GITHUB_TOKEN"] = originalToken;
	}
});

type Call = { authorization: string | null; url: string };

function stubFetch(responses: Record<string, Response>): Call[] {
	const calls: Call[] = [];
	globalThis.fetch = ((input: string, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		calls.push({ authorization: headers.get("authorization"), url: input });
		const response = responses[input];
		return response === undefined
			? Promise.reject(new Error("offline"))
			: Promise.resolve(response);
	}) as typeof fetch;
	return calls;
}

const redirect = (location: string) => new Response(null, { headers: { location }, status: 302 });

describe("fetchOkResponse", () => {
	test("keeps the token on same-origin redirects and drops it cross-origin", async () => {
		process.env["GITHUB_TOKEN"] = "t0ken";
		const calls = stubFetch({
			"https://evil.example/c": new Response("ok"),
			"https://raw.githubusercontent.com/a": redirect("/b"),
			"https://raw.githubusercontent.com/b": redirect("https://evil.example/c"),
		});
		const response = await fetchOkResponse("https://raw.githubusercontent.com/a", "file");
		expect(await response.text()).toBe("ok");
		expect(calls.map((call) => call.authorization)).toEqual(["Bearer t0ken", "Bearer t0ken", null]);
	});

	test("tags failures with their HTTP status", async () => {
		stubFetch({ "https://raw.githubusercontent.com/missing": new Response("", { status: 404 }) });
		const notFound = await fetchOkResponse(
			"https://raw.githubusercontent.com/missing",
			"file",
		).catch((error: unknown) => error);
		expect((notFound as FetchError).status).toBe(404);
		const offline = await fetchOkResponse("https://raw.githubusercontent.com/x", "file").catch(
			(error: unknown) => error,
		);
		expect((offline as FetchError).status).toBeUndefined();
	});

	test("the pinned reader classifies a 404 as a missing file, nothing else", async () => {
		stubFetch({
			"https://raw.githubusercontent.com/o/r/main/down.json": new Response("", { status: 403 }),
			"https://raw.githubusercontent.com/o/r/main/gone.json": new Response("", { status: 404 }),
		});
		const reader = pinnedReader("o/r", "main");
		const gone = await reader.text("gone.json", "file").catch((error: unknown) => error);
		expect(gone).toBeInstanceOf(UpstreamMissingError);
		expect((gone as UpstreamMissingError).rel).toBe("gone.json");
		const down = await reader.text("down.json", "file").catch((error: unknown) => error);
		expect(down).toBeInstanceOf(FetchError);
		expect(down).not.toBeInstanceOf(UpstreamMissingError);
	});

	test("gives up after too many redirects", async () => {
		stubFetch({ "https://raw.githubusercontent.com/loop": redirect("/loop") });
		await expect(fetchOkResponse("https://raw.githubusercontent.com/loop", "file")).rejects.toThrow(
			"too many redirects",
		);
	});
});
