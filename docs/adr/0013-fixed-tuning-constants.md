# Timeouts and concurrency are constants, not flags

Fetch timeouts, retries, redirect caps, fix-command timeouts, fetch parallelism, and display caps are hard-coded. Tuning them has never fixed a real failure: a timeout means the network or GitHub is down, not that the setting was wrong. Every flag is also a support surface.

## Consequences

There are no CLI flags or env vars for these. Slow runs point at the underlying service. Current values live next to the code that uses them.
