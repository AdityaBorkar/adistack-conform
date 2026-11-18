---
"@adistack/conform": major
---

Flat GitHub manifest (breaking).

The `general`, `code_planning_automation`, `security_and_quality`, and `community` wrappers are gone: their fields now live at the manifest top level in Settings-sidebar order (`default_branch`, `rulesets`, `actions`, `advanced_security`, `codeowners`, …). Only `access` and `integrations` stay grouped. Old nested blueprints fail `validate`/`check` with unrecognized-key errors until moved. Run `bun dev validate` in the tech-stack repo after migrating.
