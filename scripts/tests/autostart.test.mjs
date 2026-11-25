import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// "컴퓨터를 켤 때 · 펫 띄우기": the app writes one per-user Run value; removing the app removes it.
const read = file => fs.readFile(new URL(`../../${file}`, import.meta.url), 'utf8');

test('the uninstaller removes the same startup entry the app writes, and an update keeps it', async () => {
  const rust = await read('apps/desktop/src-tauri/src/platform/autostart.rs');
  const hooks = await read('apps/desktop/src-tauri/windows/installer-hooks.nsh');
  const config = JSON.parse(await read('apps/desktop/src-tauri/tauri.conf.json'));
  const key = rust.match(/const RUN_KEY: &str = r"([^"]+)";/u)?.[1];
  assert.equal(key, 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'per-user Run key, no administrator rights');
  assert.match(rust, /HKEY_CURRENT_USER/u);
  assert.equal(config.productName, 'AutoPets', 'the value is named after the product');
  const removal = hooks.match(/\$\{If\} \$UpdateMode <> 1\s+DeleteRegValue HKCU "([^"]+)" "\$\{PRODUCTNAME\}"\s+\$\{EndIf\}/u);
  assert.ok(removal, 'uninstall (not update) deletes the value');
  assert.equal(removal[1], key);
  const check = await read('scripts/test-bootstrap-windows.ps1');
  assert.match(check, /Uninstall left the startup entry behind/u, 'the installer check proves it on Windows');
});
