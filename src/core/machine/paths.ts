import { isAbsolute, resolve } from "node:path";

import { expandHome } from "#/utils/fs.js";

// Machine targets resolve against $HOME: a leading ~ expands, absolute
// paths pass through, anything else anchors at home (same expansion rules
// as project scope, with baseDir = home).
export function resolveTarget(target: string, home: string): string {
	const expanded = expandHome(target, home);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolve(home, expanded);
}

// The fix step materializes the fetched upstream bytes at this sibling path,
// then links target -> cache. Deriving it from the target alone keeps check
// pure: no home or repo checkout is needed to know where the link must
// point (mirrors the .conform.bak sibling convention of the project fix).
export function linkCachePath(targetPath: string): string {
	return `${targetPath}.conform-src`;
}
