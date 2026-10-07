# Grok overlay read-only launcher

Date: 2026-10-07
Status: Verified locally; installed; commit authorized
Class: 5+P — a material outside-review workflow and sandbox contract change; hardening applies to CLI authority, kernel containment, and temp lifecycle.
Baseline: gstack 40c0008919d49b55aaeb0af0eae14f51dd00cdbd; clean checkout on main. No branch/worktree changes. The user authorized a local commit after verification.
Source spec: this plan introduces docs/specs/2026-10-07-grok-read-only-launcher.md. The user authorized implementing the proposed launcher in this chat.

## Goal
Run the local Grok overlay with real read-only containment on macOS despite OrbStack's valid /var/run/docker.sock endpoint symlink. Keep Linux's native read-only sandbox. The skill, upgrade copy path, and installed helper must agree.

## Context and required reading
Read grok/SKILL.md.tmpl, bin/gstack-upgrade (apply_grok_overlay/install_overlay_files), test/gstack-upgrade-helper.test.ts, and relevant generator/validation tests. Current overlay requests plan permissions and passes an empty tools string that does not disable tools. It does not request a kernel sandbox. Grok 1.0.44 rejects a socket leaf symlink before enforcing read-only. Public source confirms explicit rejection. Tests with disposable sockets show file denies alone do not block direct AF_UNIX connects; network-outbound denies do. Installed Grok cannot apply a native sandbox beneath sandbox-exec (Operation not permitted). Therefore macOS requires one authoritative external policy, not nested sandboxes or a native custom profile.
Comprehension checks: Why must file denies be paired with Unix connection denies? Why is native off permitted only inside the external kernel sandbox, never a retry after failure?

## Accepted Spec Delta
Promote the following contract into the new spec before implementation (strategy A, new governing spec):
- bin/gstack-grok is the sole launcher for review/challenge/consult. It accepts cwd/prompt-file/model/effort/continue and other explicitly supported presentation options, rejecting sandbox/permission/tool overrides and unknown arguments. It always adds no-auto-update, no-subagents, no-leader, plan permissions, and disabled web search; forces GROK_FILE_ACCELERATION=false. macOS accepts only verified build 1.0.44 (5b807183dd79) until reviewed for a newer version. Review/challenge deny every tool; consult permits built-in read tools and denies MCP tools and write/shell tools.
- macOS launches via /usr/bin/sandbox-exec with a generated in-memory policy before Grok executes. Default filesystem reads remain allowed. Writes are limited to canonical Grok state and system temp roots plus required device files, with explicit workspace and launcher/executable write denies. Grok native sandbox is off only because the external policy supplies containment; no unconfined fallback exists.
- Deny all outbound Unix-domain socket connections (including aliases, direct targets, retargeted/new sockets, and D-Bus/systemd) without traversing runtime socket links. Permit only the root-owned system mDNSResponder endpoints for DNS. TCP/IP connectivity remains available for the model, matching macOS native read-only's documented network scope.
- Preserve direct global hook/config/trust write protection: validate real Grok-home and protected source components, reject symlinks/wrong types/absent absolute hook registry targets; deny creation of missing default slots as well as writes to existing ones; write-deny every protected source and pin ancestors against rename/mode manipulation. Grok state must not overlap the reviewed workspace; actual system temp roots are resolved independently of an arbitrary TMPDIR override, and the workspace is explicitly denied even when under temp.
- Linux uses native --sandbox read-only and never turns off network restrictions. Unsupported operating systems refuse startup.
- Resume/continue must always go through the launcher; old incompatible native profiles refuse rather than rewrite session state. Grok records native off on macOS, which does not describe the external policy. The skill explains this and never recommends direct resume.
- Failure to validate paths, construct/apply policy, locate executable, or install helper is fatal; no model request is made after a preflight failure. Preserve Grok's exit status and forward termination signals.

## Invariants / hardening
No Docker/socket mutations, no Grok user configuration rewrites, no new dependencies, no unsafe native fallback, no global weakening of Linux restrictions. Wrapper owns kernel policy; kernel, filesystem operations, and AF_UNIX connections cannot be mocked in containment tests. A fake Grok executable is allowed only to issue controlled operations under the actual launcher; argument/installer tests can use fake binaries outside that boundary. Existing static skill safety assertions must be updated to the new declared launcher contract, not deleted to hide failures. Real installed Grok startup is required; paid model smoke only if necessary to establish usability. Existing broader overlay drift is out of scope.
Hidden couplings: generated skill docs, upgrade's local overlay bundle, vendor roots, actual Grok home config hooks, native resume profile, temp directories, Unix IPC used by plugins/CLI. All-Unix denial may make local IPC integrations unavailable; this is a stronger containment boundary for outside voice, not general-purpose Grok. If core Grok cannot start under this policy, stop and replan rather than widen it silently.

## Tasks
- [x] Independent plan/spec-delta review. Answer and verify accepted findings; promote spec and record promotion baseline.
- [x] Write failing launcher enforcement/validation/upgrade tests. Run meaningful red controls. Implement one self-contained Bun launcher in bin/ with no new package dependencies. Verify workspace write denial, permitted state/temp writes, hook/config/ancestor denies, direct/alias/retargeted socket denial, child inheritance, and failure-without-launch. Include positive controls.
- [x] Wire upgrade to ship the helper with the local overlay; avoid replacing an upstream-owned skill. Update Grok template and generated outputs to invoke helper with nonempty read tool allowlist or all-tool deny. Test fresh and refreshed install fixtures and CLI rejection cases.
- [x] Run focused Bun tests, free suite required by gstack, generated freshness and diff checks. Real Grok startup under production launcher. Independent completed-work review and dispositions.

## Verification
Use bun test test/gstack-grok.test.ts test/gstack-upgrade-helper.test.ts test/skill-validation.test.ts test/gen-skill-docs.test.ts (appropriate focused filters for red controls), then bun run test:free at default shard concurrency. Real macOS enforcement tests run on this host and are platform-skipped only where Seatbelt does not exist; Linux command forwarding uses a subprocess control and retains native sandbox flags. Check generated content via gen:skill-docs dry-run and git diff --check. No implementation/test edits during an active suite run.

## Rollout / rollback
Ship helper, overlay template, upgrade copying and generated skill together; refresh the existing installed local overlay without git reset/stashing user changes. The existing upstream-owned template preservation behavior remains. Reverting this change restores the old permission-only overlay; document that it is weaker than kernel containment, not an acceptable silent runtime fallback. No service, socket, data, or schema changes.

## Deviation Log
| Spec ref | Planned | Actual | Reason | Spec proposal |
|---|---|---|---|---|

## Review and evidence
Independent plan review accepted: force no-leader and acceleration off to prevent unconfined delegation; verify exact build; bundle helper through upgrade trampoline; prove real headless feasibility early. External Seatbelt with installed Grok reached auth and catalog HTTPS requests. Model response blocked by expired/rejected credentials and account credit limit. mDNSResponder is the explicit system DNS exception, not a runtime socket exception. Protected absent paths use exact kernel creation denies rather than creating user configuration files. Spec promoted before implementation. The user reviewed the verification report and explicitly requested committing these changes. No push is authorized.

Requirements guard: run inspection inside the same external policy and refuse contributing or malformed requirements, system-requirements or MDM layers. Empty or absent layers do not override GROK_FILE_ACCELERATION=false. Consult explicitly removes search_tool/use_tool meta-tools because Grok retains them even with a built-in read allowlist.

Bootstrap is part of containment: the trusted launcher shebang disables project/global Bun config, dotenv, macros and dependency installation before entry. Hook trees are recursively validated and denied, including non-JSON files; this deliberately rejects some trees that native Grok would accept, avoiding write-through symlink/hard-link aliases.

## Final verification and review dispositions
- 1,100 focused tests pass across launcher, upgrader, skill validation, generation and coverage-floor suites. Real kernel probes cover existing and missing protected sources, canonical/private aliases, workspace alias redirects, hard-link creation, ancestor rename/chmod, child inheritance, state/temp positive controls, arbitrary TMPDIR rejection, external hook source validation, TCP and socket replacement.
- Sensitivity controls: removing the socket deny makes the socket test fail; removing protected path denies makes real workspace writes succeed and its test fail; removing --no-env-file makes the bootstrap sentinel load and its test fail. Each mutation was restored exactly. Plain Bun with project/global preloads is a positive bootstrap control. Final candidate passes.
- Independent reviewer found the Bun pre-containment preload gap (fixed via trusted shebang), alias coverage gap (fixed via alias denies and real probes), and dotenv-test sensitivity gap (fixed via an unset sentinel and neutral raw bootstrap). Recursive hook-tree validation is deliberately stricter than native validation. No remaining confirmed review defect. Final source also rejects special files in absolute hook registry entries; its added real-socket probe passes.
- Default free runner stops at shard 2 on unchanged gbrain-refresh source/test drift. All remaining shards were run using the default runner shard size/timeouts: 9/20 shards return zero, 11/20 do not. Other failures occur in unchanged browser/sidebar, Bun-polyfill and size-budget checks. No suppressions, retries, reduced parallelism or unrelated repairs. gbrain-refresh error reproduced separately and its source/test match HEAD. Broader suite is not green.
- Formatter, shell syntax, generated Claude freshness and git diff --check pass. Branch remains main. No branch/worktree switches. Local commit authorized after verification.
- Installed template, generated Claude/Codex Grok docs, helper and updater into the existing canonical install. Verified baseline bytes before replacing existing template/updater. Retained the existing unrelated overlay companion. Vendor bin/doc links resolve the new helper.
- Installed Grok 1.0.44 through the production launcher reaches authentication/catalog checks with no runtime-socket resolution or sandbox-application failure. Authentication rejection and account credit limit block a model response. This is not model-completion evidence.

## Policy provenance
The symlink rejection belongs to Grok's native sandbox runtime-socket resolver, not this overlay. Public snapshot [2bdd1d6a](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-sandbox/src/runtime_sockets.rs) explicitly rejects leaf symlinks; tests require an endpoint symlink not redirect an automatic mask. It appeared in public sync [9684fa3c](https://github.com/xai-org/grok-build/commit/9684fa3cdbf2995e30ea8b9b637f1db008f144fc) on 2026-08-27. Exact installed hash 5b807183dd79 is not available publicly, so source correspondence is not proven. Version gating, guarded inspection and real installed startup evidence limit the compatibility claim.

## Change files

- `bin/gstack-upgrade`
- `grok/SKILL.md`
- `grok/SKILL.md.tmpl`
- `test/gen-skill-docs.test.ts`
- `test/gstack-upgrade-helper.test.ts`
- `test/skill-coverage-matrix.ts`
- `test/skill-validation.test.ts`
- `bin/gstack-grok`
- `docs/lessons.md`
- `docs/plans/2026-10-07-grok-read-only-launcher.md`
- `docs/plans/README.md`
- `docs/specs/2026-10-07-grok-read-only-launcher.md`
- `test/gstack-grok.test.ts`
