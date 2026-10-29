import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const ROOT = resolve(import.meta.dir, '..');
const LAUNCHER = join(ROOT, 'bin/gstack-grok');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(temporaryRoot = tmpdir()) {
  const root = realpathSync(mkdtempSync(join(temporaryRoot, 'gstack-grok-')));
  roots.push(root);
  const home = join(root, 'home'),
    cwd = join(root, 'repo'),
    state = join(home, '.grok');
  mkdirSync(state, { recursive: true });
  mkdirSync(cwd);
  const prompt = join(root, 'prompt.json'),
    binary = join(root, 'grok');
  const environment = {
    ...process.env,
    HOME: home,
    GROK_HOME: state,
    GSTACK_GROK_BIN: binary,
  };
  // A replaceable CLI dependency issues actual operations under the production kernel sandbox.
  // It never implements policy or substitutes filesystem/socket behavior.
  writeFileSync(
    binary,
    `#!/usr/bin/env -S ${process.execPath} --config=/dev/null --no-env-file --no-macros --no-install
import fs from 'node:fs'; import net from 'node:net';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log(process.env.PROBE_VERSION || 'grok 1.0.44 (5b807183dd79) [stable]'); process.exit(0); }
if (args.includes('inspect')) { console.log(JSON.stringify({configSources:{layers:JSON.parse(process.env.PROBE_LAYERS || '[{"role":"requirements","note":"empty"}]')}})); process.exit(0); }
const q = JSON.parse(fs.readFileSync(args[args.indexOf('--prompt-file')+1], 'utf8'));
if (q.exit) process.exit(q.exit);
if (q.pause) { console.log('READY'); await new Response(Bun.stdin).text(); }
const result = {args, acceleration:process.env.GROK_FILE_ACCELERATION, dotenv:process.env.GSTACK_BOOTSTRAP_DOTENV || null, writes:{}, sockets:{}};
function attempt(name, fn) { try { fn(); result.writes[name]=true; } catch { result.writes[name]=false; } }
for (const [source,target] of q.links || []) attempt('link:'+target, () => { fs.linkSync(source,target); fs.writeFileSync(target,'linked'); });
for (const p of q.writes || []) attempt(p, () => fs.writeFileSync(p,'changed'));
for (const p of q.unlinks || []) attempt('unlink:'+p, () => fs.unlinkSync(p));
for (const p of q.renames || []) attempt('rename:'+p, () => fs.renameSync(p,p+'.moved'));
for (const p of q.chmods || []) attempt('chmod:'+p, () => fs.chmodSync(p,0o777));
if (q.childWrite) { const r = Bun.spawnSync([process.execPath,'-e', 'require("fs").writeFileSync(process.argv[1],"child")',q.childWrite], {stdout:'pipe',stderr:'pipe',timeout:30000}); result.writes.child=r.exitCode===0; }
async function connect(p) { return await new Promise(resolve => { const c=net.createConnection(p); c.once('connect',()=>{ c.destroy(); resolve(true); }); c.once('error',()=>resolve(false)); c.setTimeout(2000,()=>{c.destroy();resolve(false)}); }); }
if (q.tcp) result.tcp=await connect({host:'127.0.0.1',port:q.tcp});
for (const p of q.sockets || []) result.sockets[p]=await connect(p);
if (q.retarget) { console.log('READY'); await new Response(Bun.stdin).text(); for(const p of q.retarget) result.sockets['later:'+p]=await connect(p); }
console.log(JSON.stringify(result));
`,
    { mode: 0o755 },
  );
  function command(
    q: any = {},
    extra: string[] = [],
    env: Record<string, string> = {},
  ) {
    writeFileSync(prompt, JSON.stringify(q));
    return {
      cmd: [
        LAUNCHER,
        '--mode',
        'consult',
        '--cwd',
        cwd,
        '--prompt-file',
        prompt,
        ...extra,
      ],
      cwd: ROOT,
      env: { ...environment, ...env },
    };
  }
  return { root, home, cwd, state, prompt, binary, command, environment };
}
async function run(
  f: ReturnType<typeof fixture>,
  q: any = {},
  extra: string[] = [],
  env: Record<string, string> = {},
) {
  const p = Bun.spawn({
    ...f.command(q, extra, env),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, out, err };
}
const supported = process.platform === 'darwin' || process.platform === 'linux';
describe.skipIf(!supported)('Grok launcher contract', () => {
  test('ignores project and global Bun preloads and project dotenv before containment', async () => {
    const f = fixture();
    const marker = join(f.cwd, 'preloaded');
    const preload = join(f.cwd, 'preload.js');
    writeFileSync(
      preload,
      `require('fs').writeFileSync(${JSON.stringify(marker)},'unconfined')`,
    );
    writeFileSync(join(f.cwd, 'bunfig.toml'), 'preload = ["./preload.js"]\n');
    writeFileSync(
      join(f.home, '.bunfig.toml'),
      `preload = [${JSON.stringify(preload)}]\n`,
    );
    writeFileSync(join(f.cwd, '.env'), 'GSTACK_BOOTSTRAP_DOTENV=loaded\n');
    const command = f.command();
    command.cwd = f.cwd;
    const p = Bun.spawn({ ...command, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = await Promise.all([
      p.exited,
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ]);
    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(JSON.parse(out).args).toContain('plan');
    expect(JSON.parse(out).dotenv).toBe(null);
    expect(await Bun.file(marker).exists()).toBe(false);
    // The current repository controls a plain Bun bootstrap. This is the red control.
    const neutral = join(f.cwd, 'neutral.js');
    writeFileSync(neutral, 'console.log(process.env.GSTACK_BOOTSTRAP_DOTENV)');
    const raw = Bun.spawnSync([process.execPath, neutral], {
      cwd: f.cwd,
      env: f.environment,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    });
    expect(raw.exitCode).toBe(0);
    expect(raw.stdout.toString().trim()).toBe('loaded');
    expect(readFileSync(marker, 'utf8')).toBe('unconfined');
  });
  test('forwards selected model and enforces local, bounded read-only consult', async () => {
    const f = fixture();
    const r = await run(f, {}, [
      '--model',
      'grok-build',
      '--effort',
      'xhigh',
      '--max-turns',
      '8',
      '--continue',
    ]);
    expect(r.code).toBe(0);
    const x = JSON.parse(r.out);
    expect(x.args).toContain('--no-leader');
    expect(x.acceleration).toBe('false');
    expect(x.args).toContain('plan');
    expect(x.args).toContain('--no-subagents');
    expect(x.args).toContain('--disable-web-search');
    expect(x.args).toContain('Read,Glob,Grep');
    expect(x.args).toContain('mcp__*');
    expect(x.args).toContain('--continue');
    expect(x.args).toContain('xhigh');
    expect(x.args).toContain('grok-build');
    expect(x.args[x.args.indexOf('--sandbox') + 1]).toBe(
      process.platform === 'darwin' ? 'off' : 'read-only',
    );
  });
  test('review denies all tools and propagates child failure', async () => {
    const f = fixture();
    const r = await run(f, {}, ['--mode', 'review']);
    // Duplicate authority options must be rejected, not silently overridden.
    expect(r.code).not.toBe(0);
    expect(r.out).toBe('');
    const c = f.command({}, []);
    c.cmd[c.cmd.indexOf('consult')] = 'review';
    const p = Bun.spawn({ ...c, stdout: 'pipe', stderr: 'pipe' });
    expect(await p.exited).toBe(0);
    const x = JSON.parse(await new Response(p.stdout).text());
    expect(x.args).toContain('*');
    expect((await run(f, { exit: 23 })).code).toBe(23);
  });
  test.each([
    '--sandbox',
    '--permission-mode',
    '--tools',
    '--no-plan',
    '--leader-socket',
    '--always-approve',
    '--resume',
    '--debug-file',
  ])('rejects unsafe or unknown %s before executing Grok', async (flag) => {
    const f = fixture();
    const r = await run(f, {}, [flag, 'off']);
    expect(r.code).not.toBe(0);
    expect(r.out).toBe('');
  });
});

describe.skipIf(process.platform !== 'darwin')('real macOS containment', () => {
  test.each([tmpdir(), '/tmp'])(
    'denies workspace, hooks, config and ancestry writes under %s while state and system temp remain usable',
    async (temporaryRoot) => {
      const f = fixture(temporaryRoot);
      const hooks = join(f.state, 'hooks');
      mkdirSync(hooks);
      const hook = join(hooks, 'run.sh'),
        config = join(f.state, 'config.toml'),
        registry = join(f.state, 'hooks-paths');
      writeFileSync(hook, 'original');
      writeFileSync(config, '');
      writeFileSync(registry, '');
      const workspace = join(f.cwd, 'tracked'),
        state = join(f.state, 'session.tmp'),
        temp = join(f.root, 'scratch');
      const trust = [
        'trusted_folders.toml',
        'managed_config.toml',
        'sandbox.toml',
      ].map((name) => join(f.state, name));
      for (const file of trust) writeFileSync(file, '');
      const missing = join(f.state, 'requirements.toml');
      writeFileSync(workspace, 'original');
      const alias = workspace.replace(/^\/private\/(var|tmp)\//, '/$1/');
      const aliasedHook = hook.replace(/^\/private\/(var|tmp)\//, '/$1/');
      const repoAlias = join(f.root, 'repo-alias');
      symlinkSync(f.cwd, repoAlias);
      const redirected = join(repoAlias, 'tracked');
      const r = await run(f, {
        writes: [
          workspace,
          alias,
          aliasedHook,
          redirected,
          hook,
          config,
          registry,
          ...trust,
          missing,
          state,
          temp,
          f.binary,
        ],
        unlinks: [config],
        renames: [hooks, f.state, f.cwd],
        chmods: [hooks, f.state],
        childWrite: workspace,
        links: [[workspace, join(f.root, 'linked')]],
      });
      expect(r.code).toBe(0);
      const w = JSON.parse(r.out).writes;
      for (const p of [
        workspace,
        alias,
        aliasedHook,
        redirected,
        hook,
        config,
        registry,
        ...trust,
        missing,
        f.binary,
        'unlink:' + config,
        'rename:' + hooks,
        'rename:' + f.state,
        'rename:' + f.cwd,
        'chmod:' + hooks,
        'chmod:' + f.state,
        'child',
        'link:' + join(f.root, 'linked'),
      ])
        expect(w[p]).toBe(false);
      expect(w[state]).toBe(true);
      expect(w[temp]).toBe(true);
      expect(readFileSync(hook, 'utf8')).toBe('original');
      // Same executable outside confinement is the positive control for real writes and inheritance.
      const raw = Bun.spawnSync([f.binary, '--prompt-file', f.prompt], {
        env: f.environment,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 30_000,
      });
      expect(raw.exitCode).toBe(0);
      expect(JSON.parse(raw.stdout.toString()).writes[workspace]).toBe(true);
    },
  );
  test('refuses symlinked sources, overlapping roots, nonempty requirement pins and unknown builds without launch', async () => {
    const f = fixture();
    const target = join(f.root, 'external.toml');
    writeFileSync(target, '');
    symlinkSync(target, join(f.state, 'config.toml'));
    expect((await run(f)).code).not.toBe(0);
    rmSync(join(f.state, 'config.toml'));
    for (const env of [
      { PROBE_VERSION: 'grok 1.0.45' },
      ...['requirements', 'system-requirements', 'mdm', 'unknown'].map(
        (role) => ({ PROBE_LAYERS: JSON.stringify([{ role, path: 'pins' }]) }),
      ),
      { PROBE_LAYERS: '[{"role":"requirements","note":"parse error"}]' },
      { PROBE_LAYERS: 'null' },
      { GROK_HOME: f.cwd },
    ]) {
      const r = await run(f, {}, [], env);
      expect(r.code).not.toBe(0);
      expect(r.out).toBe('');
    }
  });
  test('does not turn arbitrary TMPDIR into a writable root and protects absolute hook registry sources', async () => {
    const f = fixture();
    const outside = mkdtempSync(join(ROOT, '.grok-probe-'));
    roots.push(outside);
    const hook = join(f.root, 'external-hook.json');
    writeFileSync(hook, 'original');
    writeFileSync(join(f.state, 'hooks-paths'), hook + '\n');
    const scratch = join(outside, 'scratch');
    const r = await run(f, { writes: [hook, scratch] }, [], {
      TMPDIR: outside,
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).writes).toEqual({
      [hook]: false,
      [scratch]: false,
    });
    writeFileSync(scratch, 'positive control');
    expect(readFileSync(scratch, 'utf8')).toBe('positive control');
    writeFileSync(join(f.state, 'hooks-paths'), join(f.root, 'absent') + '\n');
    const missing = await run(f);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toBe('');
  });
  test('refuses a special file registered as an absolute hook source', async () => {
    const f = fixture();
    const socket = join(f.root, 'invalid-hook.sock');
    const server = createServer((c) => c.end());
    try {
      await new Promise<void>((r) => server.listen(socket, r));
      writeFileSync(join(f.state, 'hooks-paths'), socket + '\n');
      const r = await run(f);
      expect(r.code).not.toBe(0);
      expect(r.out).toBe('');
      expect(r.err).toContain('invalid hook registry target type');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  test('permits TCP model egress and forwards termination to the confined child', async () => {
    const f = fixture();
    const server = createServer((c) => c.end());
    try {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const r = await run(f, { tcp: (server.address() as any).port });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.out).tcp).toBe(true);
      const p = Bun.spawn({
        ...f.command({ pause: true }),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const reader = p.stdout.getReader();
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toContain('READY');
      p.kill('SIGTERM');
      expect(await p.exited).toBe(143);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  test('blocks direct, alias, retargeted and newly created Unix sockets with live positive controls', async () => {
    const f = fixture();
    const direct = join(f.root, 'runtime.sock'),
      alias = join(f.root, 'alias.sock'),
      later = join(f.root, 'later.sock');
    const servers = [
      createServer((c) => c.end()),
      createServer((c) => c.end()),
    ];
    try {
      await new Promise<void>((r) => servers[0].listen(direct, r));
      symlinkSync(direct, alias);
      const q = { sockets: [direct, alias], retarget: [alias, later] };
      const p = Bun.spawn({
        ...f.command(q),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const reader = p.stdout.getReader();
      let out = '';
      while (!out.includes('READY\n')) {
        const v = await reader.read();
        if (v.done)
          throw new Error(
            'launcher exited before probe: ' +
              out +
              ' ' +
              (await new Response(p.stderr).text()),
          );
        out += new TextDecoder().decode(v.value);
      }
      await new Promise<void>((r) => servers[1].listen(later, r));
      rmSync(alias);
      symlinkSync(later, alias);
      p.stdin.end();
      for (;;) {
        const v = await reader.read();
        if (v.done) break;
        out += new TextDecoder().decode(v.value);
      }
      expect(await p.exited).toBe(0);
      const sockets = JSON.parse(
        out.split('\n').filter(Boolean).at(-1)!,
      ).sockets;
      expect(Object.values(sockets)).toEqual([false, false, false, false]);
      const raw = Bun.spawn({
        cmd: [f.binary, '--prompt-file', f.prompt],
        env: f.environment,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      raw.stdin.end();
      const control = await new Response(raw.stdout).text();
      expect(await raw.exited).toBe(0);
      expect(
        Object.values(
          JSON.parse(control.split('\n').filter(Boolean).at(-1)!).sockets,
        ),
      ).toEqual([true, true, true, true]);
    } finally {
      for (const server of servers)
        await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
