import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const UPGRADE = path.join(ROOT, 'bin', 'gstack-fork-upgrade');
const LOCAL_GROK = fs.readFileSync(path.join(ROOT, 'grok', 'SKILL.md.tmpl'), 'utf-8');

const gitIdentity = {
  GIT_AUTHOR_NAME: 'gstack test',
  GIT_AUTHOR_EMAIL: 'gstack@example.invalid',
  GIT_COMMITTER_NAME: 'gstack test',
  GIT_COMMITTER_EMAIL: 'gstack@example.invalid',
};

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-fork-upgrade-'));
}

function spawn(command: string[], cwd: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...gitIdentity, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function run(command: string[], cwd: string, env: Record<string, string> = {}): string {
  const result = spawn(command, cwd, env);
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed (${result.exitCode})\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

// A stand-in for upstream: setup logs its calls and, like gen-llms-txt,
// rewrites a tracked aggregate whenever a Grok template is present;
// bin/gstack-upgrade fast-forwards only and refuses on tracked edits.
function writeUpstreamFixture(root: string, version: string): void {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'VERSION'), `${version}\n`);
  fs.writeFileSync(path.join(root, 'llms.txt'), 'upstream index\n');
  fs.writeFileSync(
    path.join(root, 'setup'),
    `#!/usr/bin/env bash
set -e
repo_root="$(cd "$(dirname "$0")" && pwd -P)"
grok=no
vendor=no
[ -f "$repo_root/grok/SKILL.md.tmpl" ] && grok=yes && echo "- /grok" >> "$repo_root/llms.txt"
[ -e "$HOME/.claude/skills/gstack" ] && [ -e "$HOME/.codex/skills/gstack" ] && vendor=yes
printf '%s\\n' "$*" >> "$HOME/setup-calls"
printf 'grok=%s vendor=%s\\n' "$grok" "$vendor" >> "$HOME/setup-state"
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(root, 'bin', 'gstack-upgrade'),
    `#!/usr/bin/env bash
set -e
root="$(cd "$(dirname "$0")/.." && pwd -P)"
dirty="$(git -C "$root" status --porcelain --untracked-files=no)"
[ -z "$dirty" ] || { echo "gstack-upgrade: tracked files changed (UPGRADE_REFUSED)" >&2; exit 3; }
git -C "$root" fetch -q origin main
git -C "$root" merge --ff-only -q FETCH_HEAD
(cd "$root" && ./setup --refresh-registered </dev/null)
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(root, 'bin', 'dev-setup'), '#!/usr/bin/env bash\necho upstream-dev-setup\n', { mode: 0o755 });
}

function commitAll(dir: string, message: string): void {
  run(['git', 'add', '.'], dir);
  run(['git', 'commit', '-q', '-m', message], dir);
}

// seed (upstream history) → bare remote → install clone at v1; seed then
// moves to v2 so the install has something to fast-forward to.
function upstreamWithInstall(v2?: (seed: string) => void) {
  const fixture = tempDir();
  const home = path.join(fixture, 'home');
  const seed = path.join(fixture, 'seed');
  const remote = path.join(fixture, 'remote.git');
  const install = path.join(home, '.agents', 'skills', 'gstack');
  fs.mkdirSync(seed, { recursive: true });
  fs.mkdirSync(path.dirname(install), { recursive: true });

  run(['git', 'init', '-q', '-b', 'main'], seed);
  writeUpstreamFixture(seed, '1.0.0.0');
  commitAll(seed, 'v1');
  run(['git', 'init', '-q', '--bare', '-b', 'main', remote], fixture);
  run(['git', 'remote', 'add', 'origin', remote], seed);
  run(['git', 'push', '-q', '-u', 'origin', 'main'], seed);
  run(['git', 'clone', '-q', remote, install], fixture);

  writeUpstreamFixture(seed, '2.0.0.0');
  v2?.(seed);
  commitAll(seed, 'v2');
  run(['git', 'push', '-q'], seed);

  return { home, install, env: { HOME: home, GSTACK_INSTALL_DIR: install } };
}

describe('bin/gstack-fork-upgrade', () => {
  test('--overlay-only installs local Grok and leaves the checkout clean', () => {
    const fixture = tempDir();
    fs.mkdirSync(path.join(fixture, 'home'));
    writeUpstreamFixture(fixture, '1.0.0.0');
    run(['git', 'init', '-q', '-b', 'main'], fixture);
    commitAll(fixture, 'v1');

    const output = run(['bash', UPGRADE, '--overlay-only', fixture], ROOT, { HOME: path.join(fixture, 'home') });

    expect(output).toContain('GROK_OVERLAY=installed-local');
    expect(fs.readFileSync(path.join(fixture, 'grok', 'SKILL.md.tmpl'), 'utf-8')).toBe(LOCAL_GROK);
    expect(fs.statSync(path.join(fixture, 'bin', 'gstack-fork-upgrade')).mode & 0o111).not.toBe(0);
    expect(run(['git', 'status', '--porcelain', '--untracked-files=no'], fixture)).toBe('');
  });

  test.skipIf(process.platform === 'win32')('resolves PATH symlinks before loading the Grok overlay source', () => {
    const fixture = tempDir();
    const binDir = path.join(tempDir(), 'bin');
    const launcher = path.join(binDir, 'gstack-fork-upgrade');
    fs.mkdirSync(path.join(fixture, 'home'));
    writeUpstreamFixture(fixture, '1.0.0.0');
    run(['git', 'init', '-q', '-b', 'main'], fixture);
    commitAll(fixture, 'v1');
    fs.mkdirSync(binDir, { recursive: true });
    fs.symlinkSync(UPGRADE, launcher);

    const output = run(['bash', launcher, '--overlay-only', fixture], fixture, { HOME: path.join(fixture, 'home') });

    expect(output).toContain('GROK_OVERLAY=installed-local');
    expect(fs.readFileSync(path.join(fixture, 'grok', 'SKILL.md.tmpl'), 'utf-8')).toBe(LOCAL_GROK);
  });

  test('does not replace Grok once upstream provides its own skill', () => {
    const fixture = tempDir();
    fs.mkdirSync(path.join(fixture, 'home'));
    writeUpstreamFixture(fixture, '1.0.0.0');
    fs.mkdirSync(path.join(fixture, 'grok'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'grok', 'SKILL.md.tmpl'), 'upstream grok\n');
    run(['git', 'init', '-q', '-b', 'main'], fixture);
    commitAll(fixture, 'v1');

    const output = run(['bash', UPGRADE, '--overlay-only', fixture], ROOT, { HOME: path.join(fixture, 'home') });

    expect(output).toContain('GROK_OVERLAY=preserved-upstream');
    expect(fs.readFileSync(path.join(fixture, 'grok', 'SKILL.md.tmpl'), 'utf-8')).toBe('upstream grok\n');
  });

  test('refreshes an existing untracked Grok overlay', () => {
    const fixture = tempDir();
    fs.mkdirSync(path.join(fixture, 'home'));
    writeUpstreamFixture(fixture, '1.0.0.0');
    run(['git', 'init', '-q', '-b', 'main'], fixture);
    commitAll(fixture, 'v1');
    fs.mkdirSync(path.join(fixture, 'grok'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'grok', 'SKILL.md.tmpl'), 'old local grok\n');

    run(['bash', UPGRADE, '--overlay-only', fixture], ROOT, { HOME: path.join(fixture, 'home') });

    expect(fs.readFileSync(path.join(fixture, 'grok', 'SKILL.md.tmpl'), 'utf-8')).toBe(LOCAL_GROK);
  });

  test('upgrades through upstream bin/gstack-upgrade, relinks vendors, then reapplies the overlay', () => {
    const { home, install, env } = upstreamWithInstall();
    run(['bash', UPGRADE, '--overlay-only', install], ROOT, env);
    fs.rmSync(path.join(home, 'setup-calls'));
    fs.rmSync(path.join(home, 'setup-state'));

    const output = run(['bash', UPGRADE], ROOT, env);

    expect(fs.readFileSync(path.join(install, 'VERSION'), 'utf-8').trim()).toBe('2.0.0.0');
    expect(output).toContain('GSTACK_UPGRADE_OLD_VERSION=1.0.0.0');
    expect(output).toContain('GSTACK_UPGRADE_NEW_VERSION=2.0.0.0');
    expect(fs.readFileSync(path.join(home, '.gstack', 'just-upgraded-from'), 'utf-8').trim()).toBe('1.0.0.0');
    expect(fs.realpathSync(path.join(home, '.claude', 'skills', 'gstack'))).toBe(fs.realpathSync(install));
    expect(fs.realpathSync(path.join(home, '.codex', 'skills', 'gstack'))).toBe(fs.realpathSync(install));
    // Upstream's reinstall runs without the overlay; the overlay pass runs setup again with it.
    expect(fs.readFileSync(path.join(home, 'setup-calls'), 'utf-8').trim().split('\n')).toEqual([
      '--refresh-registered',
      '--host auto --plan-tune-hooks=prompt -q',
    ]);
    expect(fs.readFileSync(path.join(home, 'setup-state'), 'utf-8').trim().split('\n')).toEqual([
      'grok=no vendor=no',
      'grok=yes vendor=yes',
    ]);
    expect(fs.readFileSync(path.join(install, 'grok', 'SKILL.md.tmpl'), 'utf-8')).toBe(LOCAL_GROK);
    expect(fs.existsSync(path.join(install, 'bin', 'gstack-fork-upgrade'))).toBe(true);
    expect(fs.readFileSync(path.join(install, 'bin', 'gstack-upgrade'), 'utf-8')).toContain('UPGRADE_REFUSED');
    expect(fs.existsSync(path.join(install, 'bin', 'dev-setup'))).toBe(true);
    expect(run(['git', 'status', '--porcelain', '--untracked-files=no'], install)).toBe('');
    expect(run(['git', 'stash', 'list'], install).trim()).toBe('');

    const repeated = run(['bash', UPGRADE], ROOT, env);
    expect(repeated).toContain('GSTACK_UPGRADE_NEW_VERSION=2.0.0.0');
    expect(run(['git', 'status', '--porcelain', '--untracked-files=no'], install)).toBe('');
  });

  test('a release that starts tracking Grok takes over the skill', () => {
    const { install, env } = upstreamWithInstall((seed) => {
      fs.mkdirSync(path.join(seed, 'grok'), { recursive: true });
      fs.writeFileSync(path.join(seed, 'grok', 'SKILL.md.tmpl'), 'upstream grok\n');
    });
    run(['bash', UPGRADE, '--overlay-only', install], ROOT, env);

    const output = run(['bash', UPGRADE], ROOT, env);

    expect(output).toContain('GROK_OVERLAY=preserved-upstream');
    expect(fs.readFileSync(path.join(install, 'VERSION'), 'utf-8').trim()).toBe('2.0.0.0');
    expect(fs.readFileSync(path.join(install, 'grok', 'SKILL.md.tmpl'), 'utf-8')).toBe('upstream grok\n');
  });

  test('restores tracked files the pre-rename helper rewrote before upgrading', () => {
    const { install, env } = upstreamWithInstall();
    const legacy = '#!/usr/bin/env bash\necho legacy fork helper\n';
    fs.writeFileSync(path.join(install, 'bin', 'gstack-upgrade'), legacy);
    fs.rmSync(path.join(install, 'bin', 'dev-setup'));
    fs.writeFileSync(path.join(install, 'bin', 'gstack-upgrade-overlays.ts'), '// legacy\n');
    const hash = run(['git', 'hash-object', path.join(install, 'bin', 'gstack-upgrade')], install).trim();
    fs.writeFileSync(
      path.join(install, '.gstack-upgrade-overlay-manifest'),
      `${hash}\tbin/gstack-upgrade\nMISSING\tbin/dev-setup\n`,
    );

    run(['bash', UPGRADE], ROOT, env);

    expect(fs.readFileSync(path.join(install, 'VERSION'), 'utf-8').trim()).toBe('2.0.0.0');
    expect(fs.readFileSync(path.join(install, 'bin', 'gstack-upgrade'), 'utf-8')).toContain('UPGRADE_REFUSED');
    expect(fs.existsSync(path.join(install, 'bin', 'dev-setup'))).toBe(true);
    expect(fs.existsSync(path.join(install, '.gstack-upgrade-overlay-manifest'))).toBe(false);
    expect(fs.existsSync(path.join(install, 'bin', 'gstack-upgrade-overlays.ts'))).toBe(false);
  });

  test('a user edit to a tracked file makes upstream refuse, and the edit and overlay survive', () => {
    const { install, env } = upstreamWithInstall();
    fs.appendFileSync(path.join(install, 'llms.txt'), 'user edit\n');

    const result = spawn(['bash', UPGRADE], ROOT, env);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('UPGRADE_REFUSED');
    expect(fs.readFileSync(path.join(install, 'VERSION'), 'utf-8').trim()).toBe('1.0.0.0');
    expect(fs.readFileSync(path.join(install, 'llms.txt'), 'utf-8')).toContain('user edit');
    expect(fs.readFileSync(path.join(install, 'grok', 'SKILL.md.tmpl'), 'utf-8')).toBe(LOCAL_GROK);
    expect(run(['git', 'stash', 'list'], install).trim()).toBe('');
  });
});
