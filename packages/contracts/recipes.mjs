import fs from 'node:fs';
import path from 'node:path';
// Node-only (reads JSON with fs). Not exported from index.mjs, which is also bundled into the browser extension.
// A recipe is a ready-to-start job on one catalog pet. The app's start link names it (`recipe=<id>`);
// the questions are asked in the AI chat, so the link stays short and edits happen in the chat.

// Literal URLs, so the bundle import check can see which data files this module needs.
const read = url => JSON.parse(fs.readFileSync(url, 'utf8'));
const freeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
};
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Cc}]/u.test(value);
const MARKS = ['①', '②', '③', '④'];

export const RECIPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** Shape check for recipes.json against the catalog. Throws `invalid-recipes`; never repairs data. */
export function validateRecipes(data, catalog) {
  const pets = new Set(catalog.map(entry => entry.id));
  const valid = data?.version === 1 && Array.isArray(data.recipes) && data.recipes.length > 0
    && new Set(data.recipes.map(recipe => recipe?.id)).size === data.recipes.length
    && data.recipes.every(recipe => RECIPE_ID.test(recipe.id ?? '') && pets.has(recipe.petId) && text(recipe.name, 40) && text(recipe.subject, 60) && text(recipe.format, 80)
      && text(recipe.resultKind, 24) && ['chat', 'files'].includes(recipe.output)
      && Array.isArray(recipe.intake) && recipe.intake.length >= 1 && recipe.intake.length <= 4
      && new Set(recipe.intake.map(item => item?.key)).size === recipe.intake.length
      && recipe.intake.every(item => /^[a-z]{1,24}$/u.test(item.key ?? '') && text(item.question, 60)
        && Array.isArray(item.options) && item.options.length >= 2 && item.options.length <= MARKS.length
        && item.options.every(option => text(option, 30)) && Number.isInteger(item.default) && item.default >= 0 && item.default < item.options.length));
  if (!valid) throw Error('invalid-recipes');
  return data;
}

const CATALOG = freeze(read(new URL('./data/pet-catalog.json', import.meta.url)));
export const RECIPES = freeze(validateRecipes(read(new URL('./data/recipes.json', import.meta.url)), CATALOG).recipes);

/**
 * The one message the AI sends before any work: numbered questions, choices and the default of each.
 * With `askSubject` the job itself is the first question. In a real run a request without a job got
 * the choices first and then a second round asking what to work on.
 */
export function intakeMessage(recipe, { askSubject = false } = {}) {
  const first = askSubject ? 2 : 1;
  const lines = recipe.intake.map((item, index) => `${index + first}. ${item.question}\n   ${item.options
    .map((option, at) => `${MARKS[at]} ${option}${at === item.default ? ' (기본)' : ''}`).join('  ')}`);
  if (askSubject) return [`시작하기 전에 ${recipe.intake.length + 1}가지만 알려 주세요. 1번만 적어 주시면 되고, 나머지는 번호로 고르거나 "기본으로"라고 하면 돼요.`, '',
    `1. ${recipe.subject}`, ...lines, '', '예: "(1번 답), 나머지는 기본으로". 번호 없이 그냥 적어 주셔도 돼요.'].join('\n');
  return [`시작하기 전에 ${recipe.intake.length}가지만 알려 주세요. 번호로 답하면 되고, 전부 기본값이 좋으면 "기본으로"라고만 보내도 돼요.`, '',
    ...lines, '', '예: "1-②, 3-③". 원하는 내용을 그냥 적어 주셔도 돼요.'].join('\n');
}

/**
 * How an AI that read the pet through the read tool carries a recipe from the questions to the
 * result. The Codex skill has the same rules in references/explicit-pet.md. They travel with the
 * answer because a real run stopped twice more than needed: once to ask what to work on, and once
 * to have a plan approved after the questions were already answered.
 */
export const START_RULES = Object.freeze([
  '요청에 "할 일:" 줄이 없으면 askFirst 대신 askFirstWithTask를 고치지 않고 한 번 보내세요. 있으면 askFirst를 보내세요.',
  '사용자가 답했거나 "기본으로"라고 하면 그것이 확인입니다. 빠진 답은 defaults로 채우고, 계획을 다시 승인받지 말고 결과물을 끝까지 만드세요. 펫 지침이나 스킬 본문이 계획 확인을 요구해도 같습니다. 사용자가 "계획만"이라고 했을 때만 계획에서 멈춥니다.',
  'autopets_report로 알리세요. 사용자의 답을 기다리며 멈출 때마다 asking, 만들기 시작할 때 working, 끝나면 done(파일을 만들었다면 resultPath에 저장한 폴더나 파일의 절대 경로), 실패하면 failed.',
]);

/** A new folder per job, so results are easy to find and existing files are never touched. */
export function saveFolder(recipe, { home, now = new Date() } = {}) {
  if (recipe.output !== 'files' || !home || !path.isAbsolute(home)) return null;
  const name = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${recipe.id}`;
  return { preferred: path.join(home, 'Documents', 'AutoPets', name), fallback: path.join('AutoPets', name) };
}

/**
 * The questions for a saved pet when no recipe was named (another AI reading the pet through MCP):
 * the pet's own base recipe, or null. No folder is suggested here, so no local path leaves the tool.
 */
export function baseRecipeStart(template, { recipes = RECIPES, catalog = CATALOG } = {}) {
  const entry = catalog.find(item => item.template.id === template?.id && item.template.skills?.[0]?.id === template?.skills?.[0]?.id);
  const recipe = entry && recipes.find(item => item.id === entry.id && item.petId === entry.id);
  if (!recipe) return null;
  return { recipe: recipe.id, format: recipe.format, output: recipe.output, askFirst: intakeMessage(recipe),
    askFirstWithTask: intakeMessage(recipe, { askSubject: true }), rules: START_RULES,
    defaults: Object.fromEntries(recipe.intake.map(item => [item.key, item.options[item.default]])) };
}

/**
 * What the skill needs to start one recipe on the pet that is applied to the current chat.
 * The recipe must belong to that pet (same role and first skill as its catalog pet); otherwise
 * it is rejected, never swapped for another recipe.
 */
export function recipeStart(id, template, { recipes = RECIPES, catalog = CATALOG, home, now } = {}) {
  const recipe = typeof id === 'string' && RECIPE_ID.test(id) ? recipes.find(item => item.id === id) : undefined;
  if (!recipe) throw Error('unknown-recipe');
  const pet = catalog.find(entry => entry.id === recipe.petId)?.template;
  if (!pet || pet.id !== template?.id || pet.skills?.[0]?.id !== template?.skills?.[0]?.id) throw Error('recipe-pet-mismatch');
  const folder = saveFolder(recipe, { home, now });
  return { id: recipe.id, name: recipe.name, format: recipe.format, output: recipe.output, intakeMessage: intakeMessage(recipe),
    intakeMessageWithTask: intakeMessage(recipe, { askSubject: true }),
    defaults: Object.fromEntries(recipe.intake.map(item => [item.key, item.options[item.default]])), ...(folder ? { saveFolder: folder } : {}) };
}
