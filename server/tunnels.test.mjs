import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parseAccess } from '../shared/contracts.ts';
import { createTunnels, findCloudflared } from './tunnels.ts';

const directory = mkdtempSync(join(tmpdir(), 'public-link-'));
after(() => rmSync(directory, { recursive: true, force: true }));

function fake(name, version) {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "cloudflared version ${version} (built today)"; exit 0; fi
echo "$$ $*" >> "${path}.calls"
echo "INF Requesting new quick Tunnel on trycloudflare.com..." >&2
echo "INF |  https://fake-tunnel-$$.trycloudflare.com  |" >&2
exec sleep 60
`);
  chmodSync(path, 0o755);
  return path;
}
const current = fake('cloudflared', '2026.10.0');
const old = fake('cloudflared-old', '2026.9.1');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidOf = url => Number(/fake-tunnel-(\d+)/.exec(url)[1]);
const tunnels = () => createTunnels(() => findCloudflared([current]));

test('accepts emails and *@domain rules, rejects the rest', () => {
  assert.deepEqual(parseAccess(' *@Droggol.be, jan@klant.be,,jan@klant.be '), ['*@droggol.be', 'jan@klant.be']);
  assert.throws(() => parseAccess('droggol.be'), /droggol\.be/);
  assert.throws(() => parseAccess('a@b.be --url x'), /Not an email/);
});

test('refuses missing or too old cloudflared', async () => {
  await assert.rejects(findCloudflared([join(directory, 'absent')]), /not found/);
  await assert.rejects(findCloudflared([old]), /2026\.9\.1 is too old/);
  assert.equal(await findCloudflared([old, current]), current);
});

test('starts a PIN-protected link, lists it and stops it', async () => {
  const links = tunnels();
  const url = await links.start('w1', 'devkit-odoo', 8069, ['*@droggol.be', 'jan@klant.be']);
  assert.match(url, /^https:\/\/fake-tunnel-\d+\.trycloudflare\.com$/);
  assert.deepEqual(links.list(), [{ workspaceId: 'w1', scriptName: 'devkit-odoo', url, protected: true }]);
  assert.match(readFileSync(`${current}.calls`, 'utf8'), /tunnel --no-autoupdate --url http:\/\/localhost:8069 --allowed-mail \*@droggol\.be,jan@klant\.be/);
  await links.stop('w1');
  assert.deepEqual(links.list(), []);
  assert.equal(alive(pidOf(url)), false);
});

test('never opens a link without allowed addresses', async () => {
  await assert.rejects(tunnels().start('w1', 'web', 3000, []), /at least one allowed email/);
});

test('a public link skips the PIN; toggling the PIN replaces the link', async () => {
  const links = tunnels();
  const open = await links.start('w2', 'web', 3001, null);
  assert.equal(links.list()[0].protected, false);
  assert.match(readFileSync(`${current}.calls`, 'utf8'), new RegExp(`^${pidOf(open)} tunnel --no-autoupdate --url http://localhost:3001$`, 'm'));
  await links.access(() => ['a@b.be']);
  assert.equal(links.list()[0].protected, true);
  assert.equal(alive(pidOf(open)), false);
  await links.close();
});

test('closes the link when its service stops or changes port', async () => {
  const links = tunnels();
  const url = await links.start('w1', 'web', 3000, ['a@b.be']);
  await links.services('w1', [{ scriptName: 'web', lifecycle: 'running', port: 3000 }]);
  assert.equal(links.list().length, 1);
  await links.services('w1', [{ scriptName: 'web', lifecycle: 'stopped', port: null }]);
  assert.deepEqual(links.list(), []);
  assert.equal(alive(pidOf(url)), false);
});

test('changed access replaces the link; unchanged access keeps it', async () => {
  const links = tunnels();
  const first = await links.start('w1', 'web', 3000, ['a@b.be']);
  await links.access(() => ['a@b.be']);
  assert.equal(links.list()[0].url, first);
  await links.access(() => ['a@b.be', '*@klant.be']);
  const second = links.list()[0].url;
  assert.notEqual(second, first);
  assert.equal(alive(pidOf(first)), false);
  await links.access(() => []);
  assert.deepEqual(links.list(), []);
  assert.equal(alive(pidOf(second)), false);
});

test('concurrent starts leave exactly one cloudflared running', async () => {
  const links = tunnels();
  const urls = await Promise.all([links.start('w1', 'web', 3000, ['a@b.be']), links.start('w1', 'web', 3000, ['a@b.be'])]);
  assert.equal(alive(pidOf(urls[0])), false);
  assert.equal(alive(pidOf(urls[1])), true);
  await links.close();
  assert.equal(alive(pidOf(urls[1])), false);
});
