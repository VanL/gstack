# Grok outside-review containment

Date: 2026-10-07
Owner: local Grok overlay and bin/gstack-grok
Promotion baseline: gstack 40c0008919d49b55aaeb0af0eae14f51dd00cdbd; independent plan review dispositions in ../plans/2026-10-07-grok-read-only-launcher.md.

The review, challenge, and consult workflows always invoke one read-only launcher. A valid runtime-socket symlink must not prevent macOS startup. Resolving or modifying Docker sockets is unnecessary: the launcher denies all outbound Unix connections except the root-owned system DNS service. Direct, aliased, retargeted and newly created sockets remain denied. Model TCP/IP access remains available.

On macOS a single external kernel sandbox supplies containment. Grok's native sandbox is off only inside that sandbox; there is no unconfined retry. Workspace files, the launcher and executable, global hook/config/trust sources and their ancestor paths cannot be modified. Writes are limited to Grok state and actual system temporary directories with protected paths taking precedence. Symlinked or invalid protected sources refuse startup. Missing protected sources cannot be created inside confinement. State and workspace roots cannot overlap. Arbitrary TMPDIR cannot grant write access.

The macOS compatibility path accepts only Grok 1.0.44 (5b807183dd79) stable. Local execution is mandatory and file acceleration is disabled, so work cannot escape into another process. Linux retains native read-only containment; other platforms refuse. Unknown arguments and sandbox, tool, permission, leader or configuration overrides are rejected. Review and challenge deny all tools; consult permits only built-in reading tools, denies MCP tools and web tools, and remains in plan permissions. Model/effort, prompt-file, cwd, bounded max-turns and explicit continue are supported.

All launch and policy errors are fatal before a model request. Child processes inherit confinement. Exit status and termination signals reach the caller. Resuming must use this launcher because a native 'off' session record does not describe the external containment. Incompatible sessions refuse rather than rewrite state.

Upgrade installs the helper with the local overlay, including upgrades that reset the canonical checkout. It preserves upstream-owned Grok templates. Verification includes real filesystem and Unix socket probes with positive controls, direct installed-Grok headless startup and installer fixtures. Authentication or account limits are reported distinctly from containment failure.

Requirements guard: run inspection inside the same external policy and refuse contributing or malformed requirements, system-requirements or MDM layers. Empty or absent layers do not override GROK_FILE_ACCELERATION=false. Consult explicitly removes search_tool/use_tool meta-tools because Grok retains them even with a built-in read allowlist.

Bootstrap is part of containment: the trusted launcher shebang disables project/global Bun config, dotenv, macros and dependency installation before entry. Hook trees are recursively validated and denied, including non-JSON files; this deliberately rejects some trees that native Grok would accept, avoiding write-through symlink/hard-link aliases.
