/** Publication declarations, not a substitute for verifying downloaded bytes/signatures. */
export const RELEASE_EVIDENCE = Object.freeze([
  'cleanWindows', 'windowsExecution', 'codexTwoChats', 'guidanceDelivery',
  'repairAndUninstall', 'authenticode', 'signedUpdater',
]);

export function validateReleaseChannel(value) {
  const errors = [];
  if (!value || value.version !== 2 || value.platform !== 'win32-x64') errors.push('channel-format');
  if (value?.publicRelease === null) return { ok: errors.length === 0, errors, release: null };
  const release = value?.publicRelease;
  if (!release || typeof release !== 'object') return { ok: false, errors: [...errors, 'release-missing'], release: null };
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u.test(release.version || '') || release.tag !== `v${release.version}`) errors.push('pinned-version');
  function pinned(url, suffix) {
    try {
      const parsed = new URL(url);
      const prefix = `/swaan-kim/autopets/releases/download/${release.tag}/`;
      return parsed.origin === 'https://github.com' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash &&
        parsed.pathname.startsWith(prefix) && /^[A-Za-z0-9_.-]+$/u.test(parsed.pathname.slice(prefix.length)) && parsed.pathname.endsWith(suffix);
    } catch { return false; }
  }
  if (!pinned(release.installer?.url, '.exe')) errors.push('pinned-installer-url');
  if (!/^[a-fA-F0-9]{64}$/u.test(release.installer?.sha256 || '')) errors.push('installer-sha256');
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(release.installer?.authenticodeThumbprint || '')) errors.push('publisher-certificate');
  // Discovery metadata may advance; every offered installer remains pinned and signed.
  if (release.update?.url !== 'https://swaan-kim.github.io/autopets/updates/windows-x64.json') errors.push('update-channel-url');
  if (typeof release.update?.publicKey !== 'string' || !release.update.publicKey.trim() || release.update.publicKey.length > 4096) errors.push('updater-public-key');
  for (const key of RELEASE_EVIDENCE) if (release.evidence?.[key] !== true) errors.push(`evidence-${key}`);
  if (typeof release.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(release.publishedAt) || !Number.isFinite(Date.parse(release.publishedAt))) errors.push('publication-date');
  return { ok: errors.length === 0, errors, release: errors.length ? null : release };
}
