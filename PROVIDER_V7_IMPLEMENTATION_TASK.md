# Provider v7 Productization Task

You are modifying the CURRENT WORKING COPY ONLY.

Do not modify files outside this repository.
Do not modify the real user ~/.codex/config.toml.
Do not run Launcher Setup against the user's actual Codex home.
Do not use MCP, connectors, plugins, or web search.
Do not use git reset, git clean, or destructive git commands.

The immutable recovery snapshot outside this working directory must never be changed.

## Goal

Replace the current legacy Codex integration based on the top-level:

openai_base_url = "http://.../v1"

with the native named Responses provider configuration that has already passed a real Codex end-to-end test.

The managed active configuration must be:

model = "chatgpt-web/high"
model_provider = "chatgpt_web_http"

[model_providers.chatgpt_web_http]
name = "ChatGPT Web HTTP"
base_url = "<routeUrl(config)>"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
supports_standalone_web_search = false
stream_idle_timeout_ms = 300000

Do NOT hard-code port 17841.

The provider base_url must use the existing routeUrl(config), so a configured port change remains supported.

## Files to inspect first

- src/codex-integration.ts
- tests/codex-integration.test.ts
- src/setup.ts
- package.json

Preserve the existing public function API unless a change is truly necessary:

- preflightCodexIntegration
- installCodexIntegration
- activateCodexIntegration
- deactivateCodexIntegration
- uninstallCodexIntegration
- inspectCodexIntegration
- readCodexModelContextOverride
- getCodexHome
- getCodexConfigPath
- getCodexJournalPath

## Journal v7

Introduce a new current integration journal version 7.

Do not reinterpret the existing v2-v6 journal schemas as v7.

Keep explicit legacy types/read support so an installed v2-v6 integration can be migrated safely.

The v7 journal must record enough information to restore the user's previous configuration exactly.

At minimum preserve:

- previous top-level model
- previous top-level model_provider
- previous top-level openai_base_url
- previous top-level model_catalog_json
- previous [model_providers.chatgpt_web_http] table, if one existed
- previous remote_compaction_v2
- previous multi_agent
- previous multi_agent_v2
- active/disconnected state
- config path
- managed base_url
- text format information where already used

The previous provider table must be restorable byte-for-byte when no unrelated user edits occurred.

## Route installation rules

When active, the managed route must:

1. set model = "chatgpt-web/high"
2. set model_provider = "chatgpt_web_http"
3. remove a top-level openai_base_url while the managed route is active
4. remove model_catalog_json while the managed route is active
5. install exactly one [model_providers.chatgpt_web_http] table
6. keep all unrelated tables and assignments untouched
7. preserve existing line endings and trailing-newline behavior as much as the existing implementation does
8. continue installing the existing managed feature settings:
   - remote_compaction_v2 = false
   - multi_agent = true
   - multi_agent_v2 = false

Do not remove, rewrite, or reorder unrelated providers such as:

[model_providers.jdcloud_local]

or any other user provider.

## Conflict policy

A normal top-level model alone is NOT a route conflict; it must be replaced reversibly.

An explicit built-in model_provider = "openai" may be replaced reversibly without requiring --replace-codex-route, consistent with the old behavior.

Foreign routing should still require explicit replacement.

Examples of foreign routing:

- model_provider = "jdcloud_local"
- a foreign top-level openai_base_url
- model_catalog_json
- an existing [model_providers.chatgpt_web_http] table that is not already managed by this journal

Do not silently destroy such configuration.

## Disconnect / reconnect

deactivateCodexIntegration():

- verify that the v7 managed model/provider/table/features still match what this installation owns
- fail closed if a managed value was changed by the user
- restore the previous route and previous feature values
- preserve the journal
- mark active=false

activateCodexIntegration():

- if already active and valid, be idempotent
- if disconnected, verify that the restored baseline still matches the preserved baseline
- fail closed if the user changed a previously managed route value while disconnected
- reinstall the formal provider
- preserve unrelated edits
- mark active=true

## Uninstall

uninstallCodexIntegration():

- when active, verify owned values first and restore the previous configuration
- when disconnected, verify the restored baseline and leave it unchanged
- remove the journal only after successful restoration
- retain the existing transactional/compensation behavior
- invalidate models_cache.json as the current implementation does
- never remove unrelated provider tables

## URL update

A repeated install with a changed app port must update ONLY this installation's managed provider base_url.

Example:

first:
base_url = "http://127.0.0.1:17841/v1"

second:
base_url = "http://127.0.0.1:17842/v1"

The preserved pre-install baseline must not change.

## Legacy migration v2-v6

Migration must be reversible and conservative.

For an existing v2-v6 journal:

1. verify the legacy managed state using its original semantics
2. reconstruct/restore the user's legacy baseline in memory
3. install the new v7 formal provider on that baseline
4. write the new config + v7 journal transactionally
5. do not lose the original pre-integration route or feature values

For an inactive legacy v4-v6 journal, treat the already-restored config as the baseline after verifying it.

Do not fake a legacy migration by merely changing the version number.

## Provider table implementation

Implement structured helpers for:

- finding the exact [model_providers.chatgpt_web_http] table
- snapshotting it
- verifying the managed table
- removing it
- restoring a previous table
- changing only managed base_url

The managed table must contain:

name = "ChatGPT Web HTTP"
base_url = "<route URL>"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
supports_standalone_web_search = false
stream_idle_timeout_ms = 300000

Fail closed if duplicate [model_providers.chatgpt_web_http] tables exist.

## Preserve existing safety properties

Keep:

- atomic writes
- rollback/compensation
- journal/config-path identity checks
- models cache invalidation
- fail-closed behavior when managed settings have been changed
- mixed line ending preservation
- missing-final-newline preservation
- feature restoration behavior

Do not simplify these away.

## Tests

Update tests/codex-integration.test.ts to v7 semantics.

The tests must cover at minimum:

1. fresh install creates model=chatgpt-web/high
2. fresh install creates model_provider=chatgpt_web_http
3. exact provider table fields
4. no top-level openai_base_url remains active
5. uninstall restores original config byte-for-byte
6. explicit model_provider=openai restores exactly
7. foreign route requires --replace-codex-route
8. a jdcloud_local provider table survives install and uninstall byte-for-byte
9. pre-existing [model_providers.chatgpt_web_http] can be replaced only explicitly and is restored
10. repeat install updates managed base_url without changing baseline
11. disconnect restores baseline
12. reconnect reinstalls formal provider
13. inactive journal survives reload
14. fail closed if managed model changes after setup
15. fail closed if managed model_provider changes
16. fail closed if managed provider base_url changes
17. fail closed if another managed provider field changes
18. legacy v6 -> v7 migration
19. legacy v5/v4 behavior remains migratable or is represented by explicit fixture coverage
20. Windows CRLF/no-final-newline preservation
21. mixed line endings preservation
22. existing feature tests continue to pass

Do not make tests use the real ~/.codex directory.

All tests must continue using temporary CODEX_HOME fixtures.

## Validation

Inspect package.json and run the repository's real commands.

At minimum run:

bun run typecheck

and:

bun test ./tests/codex-integration.test.ts

If those pass, run the normal root test command if one exists and is reasonable for this repository.

Do not claim success if a command failed.

## Report

At the end create:

PROVIDER_V7_IMPLEMENTATION_REPORT.md

It must contain:

- files changed
- design summary
- journal migration strategy
- exact tests run
- pass/fail counts
- any remaining risks
- confirmation that the real user ~/.codex/config.toml was NOT modified

Only finish after validation.