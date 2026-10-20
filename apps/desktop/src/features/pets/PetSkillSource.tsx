import registry from '../../../../../integrations/codex/skills/skill-sources.json';
import type { PetCatalogEntry } from './petCatalog';

// Presentation follows the bundled skill manifest, not popularity or execution claims.
export function skillSourceFor(entry: PetCatalogEntry) {
  const reference = entry.template.skills[0];
  const skill = registry.skills.find(item => item.id === reference?.id && item.version === reference.version);
  const source = skill?.source;
  const parts = source ? new URL(source).pathname.split('/').filter(Boolean) : [];
  const sourcePath = parts.slice(4); // author/repository/blob-or-tree/revision precedes the file path.
  const name = source ? (sourcePath.at(-1) === 'SKILL.md' ? sourcePath.at(-2) ?? parts[1] : sourcePath.at(-1) ?? parts[1]) : 'AutoPets';
  return { skill, source, name, author: parts[0] === 'anthropics' ? 'Anthropic' : parts[0] ?? 'AutoPets',
    kind: !skill ? '출처 확인 필요' : !source ? '자체 제작' : skill.modified ? '원본 수정' : '원본 포함' };
}

export function PetSkillSource({ entry, compact = false }: { entry: PetCatalogEntry; compact?: boolean }) {
  const { skill, source, name, author, kind } = skillSourceFor(entry);
  if (compact) return <span className="pet-source-line" aria-label={`${source ? `${author} · ${name}` : 'AutoPets'} · ${kind}`}><SourceLogo external={!!source} /><span>{source ? name : 'AutoPets'}</span></span>;
  // The upstream README contains a walkthrough/demo, not an AutoPets comparison.
  const upstreamDemo = entry.id === 'presentation' && skill?.upstreamCommit && source
    ? `https://github.com/zarazhangrui/frontend-slides/blob/${skill.upstreamCommit}/README.md#what-this-does` : undefined;
  return <section className="pet-skill-source" aria-label="이 펫의 스킬 출처">
    <span className="pet-source-caption">일하는 방법 · 스킬</span>
    <strong><SourceLogo external={!!source} />{name}<span className="pet-source-kind">{kind}</span></strong>
    <p>{source ? `${author} 제작${skill?.modified ? ' · AutoPets에서 수정' : ''}` : 'AutoPets가 직접 만든 작업 방법이에요.'}</p>
    {source && <div className="pet-source-links"><a href={source} target="_blank" rel="noreferrer">GitHub 원본 보기 ↗</a>{upstreamDemo && <a href={upstreamDemo} target="_blank" rel="noreferrer">원작자 결과 예시 ↗</a>}</div>}
    {upstreamDemo && <p className="pet-source-note">원작자 예시에는 AutoPets에 포함되지 않은 기능도 있어요.</p>}
    {skill && <details><summary>버전과 이용 조건</summary><p>포함 버전 · {skill.version}</p>{skill.upstreamCommit && <p>원본 기준 · {skill.upstreamCommit}</p>}{skill.license && <p>{skill.license.spdx} · 라이선스는 스킬과 함께 포함돼요.</p>}{skill.modified && <p>한국어 요청과 현재 펫 실행 범위에 맞춰 수정했어요. 원본의 모든 기능을 포함하지는 않아요.</p>}</details>}
  </section>;
}

export function SourceLogo({ external }: { external: boolean }) {
  return <img className="pet-source-logo" src={external ? '/assets/sources/github.svg' : '/assets/brand/autopets-mark.svg'} alt="" aria-hidden="true" onError={event => { event.currentTarget.hidden = true; }} />;
}
