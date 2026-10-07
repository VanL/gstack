# Lessons

## 2026-10-07: interpreter bootstrap is part of sandbox containment

Owner: bin/gstack-grok. An external sandbox applied by a script starts too late if its interpreter first executes project or global preloads. Plain Bun loaded bunfig preloads and dotenv before launcher code on this host. Use a trusted bootstrap with config, dotenv, macros and auto-install disabled before entry. Test the actual executable shebang from an adversarial cwd, with an unset dotenv sentinel and a neutral plain-interpreter positive control. Starting tests as `bun launcher` bypasses the shebang and cannot prove this boundary.
