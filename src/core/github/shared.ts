import type * as z from "zod";

import { GithubSchema } from "#/schemas/github-settings.js";

export type GithubSettings = z.infer<typeof GithubSchema>;
