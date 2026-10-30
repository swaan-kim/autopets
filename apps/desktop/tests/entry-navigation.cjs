const dismissRoleDetail = async page => {
  await page.locator('.pet-composer').waitFor({ state: 'hidden' });
  const back = page.locator('.workspace-detail-back');
  if (await back.isVisible()) { await back.click(); await page.locator('.workspace-shelf-tabs').waitFor(); }
};
const openCatalog = async page => {
  const close = page.locator('.pet-composer').getByRole('button', { name: '← 돌아가기', exact: true });
  if (await close.isVisible()) await close.click();
  await page.locator('.app-header nav').getByRole('button', { name: '펫 고르기', exact: true }).click();
  await page.locator('.workspace-shelf-tabs').waitFor();
};
const chooseRole = async (page, name) => {
  const card = page.getByRole('button', { name: `${name} 펫 선택`, exact: true });
  if (!await card.isVisible()) {
    await openCatalog(page);
    const all = page.getByRole('button', { name: '전체 펫', exact: true });
    await all.click();
    await page.getByRole('button', { name: '전체', exact: true }).waitFor();
    if (!await card.isVisible()) await page.getByRole('button', { name: '전체', exact: true }).click();
  }
  await card.click();
  await page.locator('.workspace-role-detail').getByRole('button', { name: `${name} 이 펫으로`, exact: true }).click();
};
const openSaved = async page => {
  await openCatalog(page);
  await page.getByRole('button', { name: '내 펫', exact: true }).click();
};
const openTasks = async page => page.locator('.app-header nav').getByRole('button', { name: '내 작업', exact: true }).click();
// Copying a freely written task is a secondary path. Tests that exercise it
// explicitly disclose it, rather than changing the product's default flow.
const openCopy = async composer => {
  const fallback = composer.locator('.composer-copy-fallback');
  if (await fallback.count() && !await fallback.evaluate(element => element.open)) {
    await fallback.locator(':scope > summary').click();
  }
};
module.exports = { openCatalog, chooseRole, openSaved, openTasks, dismissRoleDetail, openCopy };
