# Git Security Policy

The repository must never commit:

- authentication tokens
- cookies or browser profiles
- auth.json
- private keys
- Codex SQLite databases
- raw Authorization headers from real sessions
- unsanitized diagnostic captures
- browser session state

A local pre-commit hook scans staged files.

Known synthetic test fixtures are allowlisted only by SHA-256
fingerprint. Changing a fixture causes it to be inspected again.

Raw runtime diagnostics remain local. Only explicitly sanitized
diagnostics may be added to this repository.