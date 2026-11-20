// The pet detail screen (.pet-start) holds the request and the one start button;
// everything else is folded under "바꾸기" (.pet-start-change).
const changeToggle = scope => scope.getByRole('button', { name: '바꾸기', exact: true });
const dismissRoleDetail = async page => {
  const back = page.locator('.pet-start .workspace-detail-back');
  if (await back.isVisible()) { await closePetPanel(page.locator('.pet-start')); await back.click(); await page.locator('.workspace-shelf-tabs').waitFor(); }
};
const openCatalog = async page => {
  await closePetPanel(page.locator('.pet-start'));
  const close = page.locator('.pet-start').getByRole('button', { name: '← 돌아가기', exact: true });
  if (await close.isVisible()) await close.click();
  // Home hides the header shortcut because its own '펫 고르기' button is on the page.
  const header = page.locator('.app-header nav').getByRole('button', { name: '펫 고르기', exact: true });
  await (await header.isVisible() ? header : page.locator('.pet-home-find')).click();
  await page.locator('.workspace-shelf-tabs').waitFor();
};
// Choosing a pet card opens its detail screen, which is where work starts.
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
  await page.locator('.pet-start').getByRole('heading', { name, exact: true }).waitFor();
};
const openSaved = async page => {
  await openCatalog(page);
  await page.getByRole('button', { name: '내 펫', exact: true }).click();
};
const openTasks = async page => {
  await closePetPanel(page.locator('.pet-start'));
  await page.locator('.app-header nav').getByRole('button', { name: '내 작업', exact: true }).click();
};
// Copying the request, settings and the chat choice are secondary paths under "바꾸기".
// Tests that exercise them disclose it explicitly instead of changing the default flow.
const openChange = async composer => {
  const toggle = changeToggle(composer);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await composer.locator('.pet-start-change').waitFor();
};
const openCopy = openChange;
const openPetSettings = openChange;
const closePetPanel = async composer => {
  const toggle = changeToggle(composer);
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'true' && await toggle.isEnabled()) await toggle.click();
};
const leaveComposer = async composer => {
  await closePetPanel(composer);
  await composer.getByRole('button', { name: '← 돌아가기', exact: true }).click();
};
module.exports = { openCatalog, chooseRole, openSaved, openTasks, dismissRoleDetail, openCopy, openPetSettings, openChange, closePetPanel, leaveComposer };
