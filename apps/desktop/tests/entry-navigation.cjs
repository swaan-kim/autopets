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
  const header = headerNav(page, '펫 고르기');
  await (await header.isVisible() ? header : page.locator('.pet-home-find')).click();
  await page.locator('.workspace-shelf-tabs').waitFor();
};
// Header buttons are looked up inside the header: home repeats '펫 고르기' as its own button.
const headerNav = (page, name) => page.locator('.app-header nav').getByRole('button', { name, exact: true });
// 설정 menu: 'AI 연결' is at the top level; the experimental pages sit under '고급 · 실험 기능'.
const ADVANCED_SETTINGS = ['자동 도움', '소개 자료', '내 펫 만들기'];
const openSettingsMenu = async page => {
  const menu = page.locator('.app-settings');
  if (await menu.getAttribute('open') === null) await menu.locator('> summary').click();
};
const openAdvancedSettings = async page => {
  await openSettingsMenu(page);
  const group = page.locator('.settings-advanced');
  if (await group.getAttribute('open') === null) await group.locator('> summary').click();
};
const openSettingsPage = async (page, name) => {
  await (ADVANCED_SETTINGS.includes(name) ? openAdvancedSettings(page) : openSettingsMenu(page));
  await page.locator('.settings-menu').getByRole('button', { name, exact: true }).click();
};
// The slot-based task list from the older flow lives in a disclosure under 'AI 연결'.
const openLegacyTasks = async page => {
  await openSettingsPage(page, 'AI 연결');
  await openDisclosure(page, '예전 방식으로 연결한 작업');
};
// Opens a <details> by its exact summary text; does nothing when it is already open.
const openDisclosure = async (scope, name) => {
  const summary = scope.locator('summary').filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  if (!await summary.evaluate(node => node.parentElement.open)) await summary.click();
};
// Screenshots carry a synthetic-data label on the status pill, which only exists in preview or when disconnected.
const labelStatusPill = (page, text) => page.evaluate(text => { const label = document.querySelector('.connection-pill'); if (label) label.textContent = text; }, text);
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
  await headerNav(page, '내 작업').click();
};
// Copying the request, settings and the chat choice are secondary paths under "바꾸기".
// Tests that exercise them disclose it explicitly instead of changing the default flow.
const openChange = async composer => {
  const toggle = changeToggle(composer);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await composer.locator('.pet-start-change').waitFor();
  await openStartDetails(composer);
};
// Inside "바꾸기", the request preview, saving, the saved-pet list, the chosen chat's id and the
// source of the pet's method are folded once more under "자세한 정보" (.pet-start-info).
const openStartDetails = async composer => {
  const info = composer.locator('.pet-start-info');
  if (await info.count() && !await info.evaluate(element => element.open)) await info.locator(':scope > summary').click();
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
module.exports = { openCatalog, chooseRole, openSaved, openTasks, dismissRoleDetail, openCopy, openPetSettings, openChange, openStartDetails, closePetPanel, leaveComposer, headerNav, openSettingsMenu, openAdvancedSettings, openSettingsPage, openLegacyTasks, openDisclosure, labelStatusPill };
