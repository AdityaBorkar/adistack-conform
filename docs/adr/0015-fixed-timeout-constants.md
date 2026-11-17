# Fetch, switch, and fan-out constants are fixed

Network fetches time out at 30s (`FETCH_TIMEOUT_MS` in `src/utils/net.ts`), the machine switch and fix commands at 10 minutes (`SWITCH_TIMEOUT_MS` in `src/stack/machine.ts`, `FIX_TIMEOUT_MS` in `src/commands/fix/apply.ts`), and upstream fetches run 16-way (`UPSTREAM_FETCH_CONCURRENCY` in `src/stack/project.ts`). Redirects cap at 5 with 3 retries, validate fans out 8-way, diffs show at most 20, template depth caps at 50, and registry lists cap at 10. They are constants, not flags, because tuning them has never fixed a real failure — a timeout means the network, nix, or GitHub is down, not that the knob was wrong.

## Consequences

No CLI flags for timeouts or concurrency. Slow runs point at the underlying service; the machine tail (`OUTPUT_TAIL_CHARS`/`OUTPUT_TAIL_LINES`) is captured on timeout so the failing derivation is visible.
