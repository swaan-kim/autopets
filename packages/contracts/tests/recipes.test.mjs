import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RECIPES, RECIPE_ID, validateRecipes, intakeMessage, saveFolder, recipeStart, baseRecipeStart, START_RULES } from '../recipes.mjs';
import { petStartRequest, codexLinkLength, fitsCodexLink, MAX_LAUNCH_URI } from '../../guidance/start-request.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const catalog = read('pet-catalog.json');
const template = id => catalog.find(entry => entry.id === id).template;
const home = path.resolve('fixture-home');

test('every catalog pet starts with a recipe of its own, and each recipe names an existing pet', () => {
  for (const entry of catalog) assert.ok(RECIPES.some(recipe => recipe.id === entry.id && recipe.petId === entry.id), entry.id);
  for (const recipe of RECIPES) {
    assert.match(recipe.id, RECIPE_ID);
    assert.ok(catalog.some(entry => entry.id === recipe.petId), recipe.id);
    assert.equal(recipe.output === 'files', template(recipe.petId).planFirst, 'file-making pets save into a folder; the others answer in chat');
  }
  assert.ok(Object.isFrozen(RECIPES[0].intake[0].options));
});

test('the chat questions are one message with numbered choices, a marked default and a one-word way out', () => {
  const recipe = RECIPES.find(item => item.id === 'presentation');
  const message = intakeMessage(recipe);
  assert.match(message, /"기본으로"/u);
  recipe.intake.forEach((item, index) => {
    assert.ok(message.includes(`${index + 1}. ${item.question}`));
    assert.ok(message.includes(`${item.options[item.default]} (기본)`));
  });
  assert.equal(message.match(/\(기본\)/gu).length, recipe.intake.length, 'exactly one default per question');
  for (const item of RECIPES) assert.ok(intakeMessage(item).length <= 700, `${item.id} stays a short message`);
});

test('a request without a job asks for the job in the same message, so there is no second round', () => {
  for (const recipe of RECIPES) {
    const message = intakeMessage(recipe, { askSubject: true });
    assert.ok(message.includes(`1. ${recipe.subject}`), recipe.id);
    recipe.intake.forEach((item, index) => assert.ok(message.includes(`${index + 2}. ${item.question}`), recipe.id));
    assert.ok(message.startsWith(`시작하기 전에 ${recipe.intake.length + 1}가지만`), recipe.id);
    assert.equal(message.match(/\(기본\)/gu).length, recipe.intake.length, 'the job itself has no default');
    assert.ok(message.length <= 760, `${recipe.id} stays a short message`);
    assert.equal(intakeMessage(recipe).includes(recipe.subject), false, 'a request that names the job is not asked again');
  }
  const template = { id: 'presentation', skills: [{ id: 'autopets-presentation', version: '1.0.0' }] };
  const start = baseRecipeStart(template);
  assert.match(start.askFirstWithTask, /1\. 무엇에 대한 발표인가요\?/u);
  assert.equal(start.rules, START_RULES);
  assert.equal(recipeStart('presentation', template).intakeMessageWithTask, start.askFirstWithTask);
  // The rules name the three breaks seen in a real run: which message, no second approval, when to report.
  assert.equal(START_RULES.length, 3);
  assert.match(START_RULES[0], /askFirstWithTask/u); assert.match(START_RULES[1], /계획을 다시 승인받지 말고/u); assert.match(START_RULES[2], /asking/u);
  assert.throws(() => validateRecipes({ version: 1, recipes: [{ ...RECIPES[0], subject: '' }] }, [{ id: RECIPES[0].petId }]), /invalid-recipes/u);
});

test('starting a recipe returns only that pet\'s questions; unknown or foreign recipes are rejected, not swapped', () => {
  const now = new Date(2026, 10, 12);
  const slides = recipeStart('presentation', template('presentation'), { home, now });
  assert.equal(slides.output, 'files');
  assert.equal(slides.saveFolder.preferred, path.join(home, 'Documents', 'AutoPets', '1112-presentation'));
  assert.equal(slides.saveFolder.fallback, path.join('AutoPets', '1112-presentation'));
  assert.equal(slides.defaults.length, '5장');
  assert.match(slides.format, /PowerPoint 파일 아님/u);
  const study = recipeStart('study-helper', template('study-helper'), { home, now });
  assert.equal(study.output, 'chat'); assert.equal(study.saveFolder, undefined);
  assert.throws(() => recipeStart('presentation', template('ui-webpage'), { home }), /recipe-pet-mismatch/);
  assert.throws(() => recipeStart('presentation', { instruction: 'x', skills: [] }, { home }), /recipe-pet-mismatch/);
  for (const id of ['nope', '../x', '', undefined, 'Presentation']) assert.throws(() => recipeStart(id, template('presentation'), { home }), /unknown-recipe/);
  assert.equal(saveFolder(RECIPES.find(item => item.id === 'presentation'), { home: 'relative' }), null);
});

test('recipe data is checked, never repaired', () => {
  const data = read('recipes.json');
  const broken = change => { const copy = structuredClone(data); change(copy.recipes[0]); return copy; };
  for (const change of [r => { r.petId = 'missing'; }, r => { r.intake[0].default = 9; }, r => { r.intake = []; }, r => { r.output = 'email'; },
    r => { r.id = 'Bad Id'; }, r => { r.intake[0].options = ['only one']; }, r => { r.intake[1].key = r.intake[0].key; }]) {
    assert.throws(() => validateRecipes(broken(change), catalog), /invalid-recipes/);
  }
  assert.throws(() => validateRecipes({ ...data, recipes: [...data.recipes, data.recipes[0]] }, catalog), /invalid-recipes/);
});

test('the start request names the pet and recipe and always fits a Codex link with a real one-line job', () => {
  const id = '3f2b8c1e-aaaa-4bbb-8ccc-1234567890ab';
  const job = '동아리 신입 부원 모집 발표자료를 만들고 싶어. 활동 소개와 일정, 지원 방법을 넣어줘.';
  for (const recipe of RECIPES) {
    const request = petStartRequest({ name: recipe.name, petId: id, petRevision: 12, recipe: recipe.id, task: job });
    assert.ok(request.startsWith(`AutoPets 스킬로 "${recipe.name}" 시작해줘. petId=${id}, petRevision=12, recipe=${recipe.id}.`));
    assert.ok(request.includes(`할 일: ${job}`));
    assert.ok(fitsCodexLink(request), `${recipe.id}: ${codexLinkLength(request)}`);
    assert.ok(codexLinkLength(request) < MAX_LAUNCH_URI * 0.6, 'room is left for a longer job');
  }
  const bare = petStartRequest({ name: '발표자료 만들기', petId: id, petRevision: 1, recipe: 'presentation' });
  assert.equal(bare.split('\n').length, 1, 'an empty job sends only the call; the questions come in the chat');
  const full = petStartRequest({ name: '웹페이지 만들기', petId: id, petRevision: 1, recipe: 'ui-webpage', task: ' 소개 페이지 ', audience: '신입생', message: '일정', newTask: true, figma: true });
  assert.deepEqual(full.split('\n').slice(1), ['할 일: 소개 페이지', '이 페이지를 볼 사람: 신입생', '꼭 알릴 내용: 일정',
    '새 작업이야. 이전 작업의 계획이나 승인을 재사용하지 마.', 'Figma 시안을 쓸 거야. 프레임 링크부터 나에게 확인해줘.']);
  assert.equal(codexLinkLength('a b가'), 'codex://threads/new?prompt='.length + 1 + 3 + 1 + 9);
  // Claude reaches AutoPets through its tools, so only the first words differ; the rest is the same request.
  const viaTool = petStartRequest({ name: '발표자료 만들기', petId: id, petRevision: 1, recipe: 'presentation', task: job, via: 'tool' });
  assert.ok(viaTool.startsWith(`AutoPets 도구(autopets_read_pet)로 "발표자료 만들기" 펫을 불러와 시작해줘. petId=${id}, petRevision=1, recipe=presentation.`));
  assert.deepEqual(viaTool.split('\n').slice(1), petStartRequest({ name: '발표자료 만들기', petId: id, petRevision: 1, recipe: 'presentation', task: job }).split('\n').slice(1));
});
