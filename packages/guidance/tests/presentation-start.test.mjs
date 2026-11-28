import test from 'node:test';
import assert from 'node:assert/strict';
import { petStartRequest, presentationRequest, fitsCodexLink } from '../start-request.mjs';
import { readPinnedSkill, readBundledSkill } from '../../../integrations/codex/runtime/pet-skills.mjs';

test('format choices travel independently without forcing HTML or optional photos', () => {
  const identity = { name: '발표자료 만들기', petId: '3f2b8c1e-aaaa-4bbb-8ccc-1234567890ab', petRevision: 1, recipe: 'presentation', task: '동아리 모집 발표를 5장으로 만들고 싶어.' };
  for (const [format, label] of [['recommend', '추천받기'], ['html', 'HTML'], ['figma', 'Figma'], ['pptx', 'PPTX']]) {
    const request = petStartRequest({ ...identity, presentation: { format } });
    assert.ok(request.includes(`발표 형식: ${label}.`));
    assert.ok(!request.includes('참고 사진'));
    assert.ok(fitsCodexLink(request));
  }
  const request = petStartRequest({ ...identity, presentation: { format: 'pptx', design: '네이비와 아이보리', reference: true } });
  assert.ok(request.includes('디자인 요청: 네이비와 아이보리'));
  assert.ok(request.includes('참고 사진은 채팅에 첨부'));
  assert.ok(!request.includes('HTML'));
  assert.ok(fitsCodexLink(request));
  assert.throws(() => presentationRequest({ format: 'unknown' }), /invalid-presentation-format/);
  assert.equal(presentationRequest({ design: '차분한\n분위기' }).length, 2);
  assert.ok(!presentationRequest({ design: '차분한\n분위기' })[1].includes('\n'));
  assert.ok(!petStartRequest({ ...identity, recipe: 'study-helper', presentation: { format: 'pptx' } }).includes('PPTX'), 'presentation preferences never leak into another task');
});

test('a saved HTML-era pet retains its exact skill while new pets read the new version', async () => {
  const old = await readPinnedSkill('autopets-presentation', '1.0.0');
  const current = await readBundledSkill('autopets-presentation');
  assert.equal(old.sha256, 'c0ce4396ec4f4c2c375100e6b1ee56415492897b8c51d1320eec240ca459acb0');
  assert.equal(current.version, '1.1.0');
  assert.notEqual(old.sha256, current.sha256);
});
