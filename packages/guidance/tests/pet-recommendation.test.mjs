import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recommendPets, buildRecommender, MAX_REQUEST_CHARS } from '../pet-recommendation.mjs';

const catalog = JSON.parse(await readFile(new URL('../../contracts/data/pet-catalog.json', import.meta.url), 'utf8'));
const intents = JSON.parse(await readFile(new URL('../../contracts/data/pet-intents.json', import.meta.url), 'utf8'));
const ids = text => recommendPets(text).candidates.map(item => item.petId);

test('every intent entry points at an existing catalog pet and compiles', () => {
  const known = new Set(catalog.map(entry => entry.id));
  for (const intent of intents.intents) {
    assert.ok(known.has(intent.petId), intent.petId);
    for (const key of ['strong', 'topics', 'deliverables']) for (const source of intent[key] ?? []) assert.doesNotThrow(() => new RegExp(source, 'giu'));
    for (const id of intent.suppressedBy ?? []) assert.ok(known.has(id), id);
  }
});

test('clear requests recommend the matching existing pet', () => {
  const cases = {
    '오늘 한 일 정리해줘': 'daily-plan', '부산 2박 3일 여행 일정 짜줘': 'travel-plan', '네트워크 시험 공부 도와줘': 'study-helper',
    '쇼핑몰 웹사이트 만들어줘': 'ui-webpage', '신제품 홍보 문구 작성해줘': 'marketing-copy', 'AI 산업 발표자료 10장 만들어줘': 'presentation',
    'AI 산업 동향 발표자료 만들어줘': 'presentation', '부산 여행 코스 짜줘': 'travel-plan', '파이썬 공부 도와줘': 'study-helper',
    '웹사이트 하나 만들어줘': 'ui-webpage', '상품 광고 문구 작성해줘': 'marketing-copy', '내일 할 일 우선순위 정리해줘': 'daily-plan',
    '다음 주 강릉 1박 2일로 놀러 갈 건데 동선 좀 짜줄래?': 'travel-plan', '회사 소개 프레젠테이션 구성해 주세요': 'presentation',
  };
  for (const [text, petId] of Object.entries(cases)) assert.deepEqual(ids(text), [petId], text);
});

test('a reason and the triggering words are returned, without repeated cues', () => {
  const [item] = recommendPets('부산 2박 3일 여행 일정 짜줘').candidates;
  assert.equal(item.reason, '여행 일정을 계획하려는 것 같아요.');
  assert.ok(item.cues.includes('2박 3일') && item.cues.includes('여행 일정'));
  assert.ok(!item.cues.includes('여행'));
});

test('compound requests offer at most two pets in the order the work appears', () => {
  assert.deepEqual(ids('제주도 여행 일정을 계획하고 발표자료로 정리해줘'), ['travel-plan', 'presentation']);
  // The page is the deliverable; marketing is a secondary fit.
  assert.deepEqual(ids('홍보 웹페이지 만들어줘'), ['ui-webpage', 'marketing-copy']);
  assert.ok(ids('부산 여행 일정 짜고 발표자료 만들고 홍보 문구도 작성해줘').length <= 2);
  // A travel day is not a generic daily list.
  assert.deepEqual(ids('내일 부산 여행 계획 세워줘'), ['travel-plan']);
});

test('greetings, questions, AutoPets commands and unclear work are not forced into a pet', () => {
  for (const text of ['안녕하세요!', '고마워', 'ok', '']) assert.equal(recommendPets(text).status, 'skipped', text);
  for (const text of ['펫 상태 확인', '그대로 구현해줘', '여행 일정 펫으로 진행해줘', '$autopets 연결해줘', 'AutoPets 스킬로 제작 펫 연결해줘']) {
    assert.equal(recommendPets(text).reason, 'autopets-command', text);
  }
  for (const text of ['발표자료가 뭐야?', '여행 가고 싶다', '이거 좀 봐줘', '이 함수 버그 고쳐줘', 'README 업데이트해줘', '회의록 요약해줘', '이 코드 리팩터링하고 테스트 추가해줘']) {
    assert.deepEqual(ids(text), [], text);
  }
});

test('an already applied pet is not recommended again', () => {
  const result = recommendPets('부산 2박 3일 여행 일정 짜줘', { exclude: ['travel-plan'] });
  assert.equal(result.status, 'none'); assert.equal(result.reason, 'already-using');
});

test('request text is kept for prefill but bounded', () => {
  const long = `발표자료 만들어줘 ${'가'.repeat(MAX_REQUEST_CHARS + 50)}`;
  const result = recommendPets(long);
  assert.equal(result.request.length, MAX_REQUEST_CHARS); assert.equal(result.requestTruncated, true);
  assert.equal(recommendPets('  부산  여행\n코스 짜줘 ').request, '부산 여행 코스 짜줘');
  assert.equal(recommendPets(`발표자료 만들어줘 ${'x'.repeat(9000)}`).reason, 'too-long');
});

test('a new catalog pet without intent data is still recommended by its exact name', () => {
  const recommender = buildRecommender({ catalog: [...catalog, { id: 'recipe-helper', name: '레시피 도우미' }], intents });
  assert.deepEqual(recommendPets('레시피 도우미로 저녁 메뉴 정리해줘', { recommender }).candidates.map(item => item.petId), ['recipe-helper']);
  assert.deepEqual(recommendPets('저녁 메뉴 정리해줘', { recommender }).candidates.map(item => item.petId), []);
});

test('negated cues, development requests and partial words never recommend a pet', () => {
  assert.deepEqual(ids('발표 자료 말고 웹페이지로 만들어줘'), ['ui-webpage'], 'the excluded deliverable is not offered');
  for (const text of ['PPT 말고 문서로 정리해줘', '발표자료는 필요 없고 요약만 해줘', '슬라이드 넘기는 애니메이션 버그 고쳐줘', '이 PPT 파일 파싱하는 코드 작성해줘',
    'README에 프레젠테이션 링크 추가해줘', 'DB 인덱스 만들어줘', '고객 인사이트 보고서 만들어줘', '광고 차단 기능 만들어줘', '슬로건 기능 테스트 짜줘',
    '오늘 커밋 정리해줘', '이번 주 스프린트 회고 정리해줘']) assert.deepEqual(ids(text), [], text);
  assert.equal(recommendPets('슬라이드 넘기는 애니메이션 버그 고쳐줘').reason, 'development');
});

test('plain English requests reach the same pets', () => {
  assert.deepEqual(ids('make a presentation about AI'), ['presentation']);
  assert.deepEqual(ids('create a landing page for my cafe'), ['ui-webpage']);
  assert.deepEqual(ids('Write marketing copy for a new tea'), ['marketing-copy']);
});
