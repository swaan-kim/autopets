import path from 'node:path';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const metricRows = [
  ['프레임 간격 p95 (ms)', pet => pet.timing.p95],
  ['가장 긴 프레임 (ms)', pet => pet.timing.max],
  ['34ms 넘은 프레임', pet => pet.timing.over34],
  ['겹침 없는 자세 교체 / 초', pet => pet.pose.hardSwapsPerSecond],
  ['발 위치가 튀는 횟수 / 초 (한 프레임에 펫 높이 2% 초과)', pet => pet.pose.pawJumpsPerSecond],
  ['프레임당 최대 발 이동 (펫 높이 대비)', pet => pet.pose.pawJumpMax],
  ['드래그 중 최대 기울기 (°)', pet => pet.leanMax],
  ['카드 열림', pet => pet.cardOpens],
  ['완료 동작', pet => pet.completions],
  ['재생된 동작', pet => pet.clips.join(' → ')],
];

// Builds a self-contained review page. Videos are linked relatively, never copied.
export function compareHtml(runs, outputFile) {
  const directory = path.dirname(outputFile);
  const ids = [...new Set(runs.flatMap(run => run.report.scenarios.map(scenario => scenario.id)))];
  const sections = ids.map(id => {
    const items = runs.map(run => ({ run, scenario: run.report.scenarios.find(item => item.id === id) }));
    const title = items.find(item => item.scenario)?.scenario.title ?? id;
    const videos = items.map(({ run, scenario }) => `<figure><figcaption>${escape(run.report.label)}</figcaption>${scenario?.notApplicable ? `<p>해당 없음 · ${escape(scenario.notApplicable)}</p>` : scenario?.video
      ? `<video muted playsinline preload="metadata" src="${escape(path.relative(directory, path.join(run.directory, scenario.video)).split(path.sep).join('/'))}"></video>` : '<p>기록 없음</p>'}</figure>`).join('');
    const checks = items.map(({ run, scenario }) => `<td>${(scenario?.expectations ?? []).map(check => `<div class="${check.pass ? 'pass' : 'fail'}">${check.pass ? '통과' : '확인 필요'} · ${escape(check.name)}<small>${escape(check.detail)}</small></div>`).join('') || '—'}</td>`).join('');
    const rows = metricRows.map(([label, read]) => `<tr><th>${escape(label)}</th>${items.map(({ scenario }) => `<td>${scenario?.pets?.[0] ? escape(read(scenario.pets[0])) : '—'}</td>`).join('')}</tr>`).join('');
    const resource = `<tr><th>렌더러 CPU (초/초)</th>${items.map(({ scenario }) => `<td>${escape(scenario?.resource?.cpuPerSecond ?? '—')}</td>`).join('')}</tr>`;
    return `<section><h2>${escape(id)} · ${escape(title)}</h2><div class="videos">${videos}</div><button type="button" class="play">함께 재생</button>
      <table><thead><tr><th></th>${items.map(({ run }) => `<th>${escape(run.report.label)}</th>`).join('')}</tr></thead><tbody>${rows}${resource}<tr><th>기대 동작</th>${checks}</tr></tbody></table></section>`;
  }).join('\n');
  const sources = runs.map(run => `<li><strong>${escape(run.report.label)}</strong> · 소스 ${escape(run.report.source.commit?.slice(0, 12) ?? '알 수 없음')}${run.report.source.dirty ? ' (미커밋 변경 포함)' : ''} · ${escape(run.report.browser)} · 배율 ${escape(run.report.scale)} · ${escape(run.report.recordedAt)}</li>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AutoPets 모션 비교</title><style>
body{margin:0;padding:28px;font-family:'Segoe UI','Pretendard',sans-serif;color:#213c2c;background:#f8faf7}h1{font-size:24px;margin:0 0 6px}
.note{color:#8a4b2d;font-weight:600}section{margin:26px 0;padding:18px;border:1px solid #e3eae0;border-radius:18px;background:white}h2{font-size:17px;margin:0 0 12px}
.videos{display:flex;gap:14px;flex-wrap:wrap}figure{margin:0}figcaption{font-size:12px;margin-bottom:4px}video{width:380px;max-width:100%;border:1px solid #dfe6dc;border-radius:10px;background:#eef1ec}
button{margin:10px 0;padding:7px 12px;border-radius:9px;border:1px solid #9fb6a5;background:#f2f6f0;cursor:pointer}table{border-collapse:collapse;font-size:13px;margin-top:4px}
th,td{padding:5px 10px;border-bottom:1px solid #eef1ec;text-align:left;vertical-align:top}td small{display:block;color:#6b7d6e}.pass{color:#2f6b45}.fail{color:#a3472a}
</style></head><body><h1>AutoPets 모션 비교</h1><p class="note">합성 검사 · 별도 헤드리스 브라우저 · 가상 포인터 · 가상 작업. 실제 Windows 오버레이·실제 채팅·설치 앱 결과가 아닙니다.</p>
<ul>${sources}</ul><p>평균 fps나 영상 인코딩 fps로 자연스러움을 판정하지 않습니다. 프레임 지연과 자세 불연속을 따로 보고, 영상으로 직접 확인하세요.</p>${sections}
<script>document.querySelectorAll('section').forEach(section=>{const videos=[...section.querySelectorAll('video')];section.querySelector('.play').addEventListener('click',()=>{videos.forEach(video=>{video.currentTime=0;void video.play();});});});</script></body></html>`;
}
