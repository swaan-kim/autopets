import { useEffect, useRef, useState } from 'react';
import type { ArtifactProject, ArtifactReview, ArtifactRevision, ArtifactVersion, AssistanceSnapshot, ChatIdentity, IntroBrief, IntroStyle, IntroTemplate, IntroTemplateId, SavedIntroStyle, WorkflowSnapshot } from '@autopets/contracts/types';
import templateData from '../../../../../packages/contracts/data/intro-templates.json';
import { buildIntroPrompt } from '../../../../../packages/guidance/intro.mjs';
import { command, isDesktop } from '../../bridge/command';
import { useArtifacts } from '../../bridge/useArtifacts';
import { Modal } from '../../app/shared/Modal';
import { identityKey, uniqueIdentities } from '../assistance/identity';
import { TemplatePreview } from './TemplatePreview';
import { ArtifactImage } from './ArtifactImage';
import { readPng } from './files';
import './intro.css';

const templates = templateData.templates as IntroTemplate[];
const emptyBrief = (): IntroBrief => ({ audience: '', message: '', points: [], sourceText: '', sourceLabel: '' });
const emptyStyle = (): IntroStyle => ({ palette: ['#435B47', '#A9BE93', '#F6F8F2'], logoDataUrl: null, copyLength: 'short', layout: 'landscape' });
const dateLabel = (value: number) => new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const reviewLabels = { readability: '글자가 읽기 쉽고 잘리지 않아요', layout: '배치와 여백이 의도에 맞아요', fidelity: '문구와 사실이 원문에 맞아요' } as const;
const revisionOptions = [{ kind: 'shorten', label: '글 줄이기', instruction: '핵심 의미와 사실을 유지하면서 글을 짧게 줄여주세요.' }, { kind: 'emphasize', label: '핵심 강조', instruction: '핵심 메시지와 가장 중요한 근거를 눈에 잘 띄게 강조해주세요.' }, { kind: 'restructure', label: '구성 바꾸기', instruction: '내용을 유지하면서 정보의 순서와 시각적 구성을 바꿔주세요.' }] as const;

export function IntroStudio({ assistance, workflow, sessions, onWorkflow }: { assistance: AssistanceSnapshot; workflow: WorkflowSnapshot; sessions: { id: string; label: string }[]; onWorkflow: (identity: ChatIdentity) => void }) {
  const artifacts = useArtifacts();
  const [selected, setSelected] = useState('');
  const [templateId, setTemplateId] = useState<IntroTemplateId>('product-intro');
  const isFavorite = (identity: ChatIdentity) => Boolean(artifacts.snapshot.projects.find(item => identityKey(item.identity) === identityKey(identity))?.favorite);
  const identities = uniqueIdentities(assistance.tasks, workflow.tasks, artifacts.snapshot.observedChats.map(identity => ({ identity })), artifacts.snapshot.projects).filter(identity => identity.provider === 'codex').sort((a, b) => Number(isFavorite(b)) - Number(isFavorite(a)));
  const identity = identities.find(item => identityKey(item) === selected);
  const project = artifacts.snapshot.projects.find(item => identityKey(item.identity) === selected);
  useEffect(() => { if (selected && !identity) setSelected(''); }, [selected, identity]);
  const chooseChat = (key: string) => {
    setSelected(key);
    setTemplateId(artifacts.snapshot.projects.find(item => identityKey(item.identity) === key)?.templateId || 'product-intro');
  };
  return <section className="intro-studio" aria-label="소개 자료 스튜디오">
    <header className="intro-hero"><div><span className="eyebrow">INTRO STUDIO</span><h1>한 장 소개 자료 만들기<span aria-hidden="true">↗</span></h1><p>전하고 싶은 내용을 담고, 이미지로 확인하고,<br className="intro-desktop-break" /> 마음에 드는 스타일은 다음에도 꺼내 써요.</p></div><span className="intro-hero-seal" aria-hidden="true">A<br /><small>GOOD<br />INTRO.</small></span></header>
    <div className="intro-flow" aria-label="만드는 순서"><span><b>01</b> 내용 준비</span><i>→</i><span><b>02</b> 채팅에서 생성</span><i>→</i><span><b>03</b> 확인하고 저장</span></div>
    <div className="intro-section-head"><div><span className="intro-kicker">START WITH A FORMAT</span><h2>어떤 이야기를 전할까요?</h2></div><span className="intro-muted">세 가지 구성으로 가볍게 시작해요.</span></div>
    <div className="intro-template-grid" role="group" aria-label="소개 자료 템플릿">{templates.map(template => <button type="button" className={`intro-template ${templateId === template.id ? 'selected' : ''}`} key={template.id} aria-pressed={templateId === template.id} disabled={artifacts.busy} onClick={() => setTemplateId(template.id)}><div className="intro-template-art"><TemplatePreview templateId={template.id} /><span>레이아웃 예시</span></div><div className="intro-template-copy"><strong>{template.title}</strong><span className="intro-template-check" aria-hidden="true">{templateId === template.id ? '✓' : '↗'}</span><p>{template.description}</p></div></button>)}</div>
    <p className="intro-provenance">구성 참고: <a href={templateData.skill.url} target="_blank" rel="noreferrer">baoyu-infographic</a> · 고정 버전 {templateData.skill.commit.slice(0, 7)} · AutoPets 연결은 아직 실환경 미검증</p>
    {!isDesktop && <p className="intro-notice" role="status">브라우저에서는 읽기 전용 미리보기예요. 연결된 채팅과 생성 이미지는 없으며, 저장·이미지 생성은 실행되지 않아요.</p>}
    {artifacts.error && <div className="error" role="alert">{artifacts.error}<button type="button" className="text-button" onClick={() => void artifacts.refresh()}>저장 상태 다시 확인</button></div>}
    <div className="intro-chat-select"><label htmlFor="intro-chat">이 자료를 만들 Codex 채팅</label><select id="intro-chat" value={selected} disabled={!isDesktop || artifacts.busy || !artifacts.loaded} onChange={event => chooseChat(event.target.value)}><option value="">채팅을 선택해주세요</option>{identities.map(item => <option value={identityKey(item)} key={identityKey(item)}>{isFavorite(item) ? '★ ' : ''}{sessions.find(session => session.id === item.chatId)?.label || item.chatId} · {item.accountId}</option>)}</select><p>관측된 채팅만 표시해요. 선택한 계정과 채팅에 자료를 따로 보관해요.</p></div>
    {identity ? <IntroEditor key={identityKey(identity)} identity={identity} project={project} artifacts={artifacts} templateId={templateId} setTemplateId={setTemplateId} onWorkflow={onWorkflow} /> : <div className="intro-empty"><span aria-hidden="true">▧</span><h3>{identities.length ? '자료를 만들 채팅을 골라주세요' : '연결된 Codex 채팅을 기다리고 있어요'}</h3><p>{identities.length ? '내용과 결과는 선택한 채팅 안에서만 이어져요.' : 'Codex에서 활동이 관측되면 이곳에서 선택할 수 있어요.'}</p><span className="intro-muted">예시 이미지는 구성 안내이며 생성된 결과가 아니에요.</span></div>}
  </section>;
}

function IntroEditor({ identity, project, artifacts, templateId, setTemplateId, onWorkflow }: { identity: ChatIdentity; project?: ArtifactProject; artifacts: ReturnType<typeof useArtifacts>; templateId: IntroTemplateId; setTemplateId: (value: IntroTemplateId) => void; onWorkflow: (identity: ChatIdentity) => void }) {
  const [brief, setBrief] = useState<IntroBrief>(() => project?.brief || emptyBrief());
  const [style, setStyle] = useState<IntroStyle>(() => project?.style || emptyStyle());
  const [points, setPoints] = useState(() => project?.brief.points.join('\n') || '');
  const [baseRevision, setBaseRevision] = useState(project?.revision || 0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const alive = useRef(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [versionId, setVersionId] = useState(project?.versions.at(-1)?.id || '');
  const [compareId, setCompareId] = useState('');
  const [renderedText, setRenderedText] = useState('');
  const [png, setPng] = useState<{ bytes: number[]; name: string } | null>(null);
  const [fileReset, setFileReset] = useState(0);
  const [revisionText, setRevisionText] = useState('');
  const [styleName, setStyleName] = useState('');
  const [editingStyleId, setEditingStyleId] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const disabled = !isDesktop || !artifacts.loaded || artifacts.busy || localBusy;
  const version = project?.versions.find(item => item.id === versionId) || project?.versions.at(-1);
  const compareVersion = project?.versions.find(item => item.id === compareId);
  const blockingChecks = version?.checks.filter(check => check.method === 'code' && ['png', 'numbers'].includes(check.id) && check.status !== 'pass') || [];
  const styles = [...artifacts.snapshot.styles].sort((a, b) => b.updatedAt - a.updatedAt);
  const draft: ArtifactProject = { identity, revision: baseRevision, templateId, brief: { ...brief, points: points.split('\n').map(value => value.trim()).filter(Boolean) }, style, versions: project?.versions || [], pendingRevision: project?.pendingRevision || null, favorite: project?.favorite || false, updatedAt: project?.updatedAt || 0 };
  const hasUnsaved = !project || project.templateId !== templateId || JSON.stringify(project.brief) !== JSON.stringify(draft.brief) || JSON.stringify(project.style) !== JSON.stringify(style);
  const validPoints = draft.brief.points.length > 0 && draft.brief.points.length <= 5 && draft.brief.points.every(point => [...point].length <= 160);
  let canSave = Boolean(draft.brief.audience.trim() && draft.brief.message.trim() && validPoints);
  let prompt = '대상, 핵심 메시지와 포인트를 입력하면 요청 문구가 준비돼요.';
  if (canSave) {
    try { prompt = buildIntroPrompt(draft); }
    catch { canSave = false; prompt = '입력한 내용과 스타일의 형식을 확인해주세요. 올바른 내용이 준비되면 요청 문구를 만들 수 있어요.'; }
  }
  useEffect(() => { if (project && !hasUnsaved) setBaseRevision(project.revision); }, [project?.revision, hasUnsaved]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bound = { identity, expectedRevision: project?.revision || 0 };
  const report = (message: string) => { if (alive.current) { setNotice(message); setError(''); } };
  const saveBrief = async () => {
    if (!canSave || disabled) return null;
    const result = await artifacts.dispatch({ operation: 'save-brief', identity, expectedRevision: baseRevision, templateId, brief: draft.brief, style });
    const saved = result?.projects.find(item => identityKey(item.identity) === identityKey(identity));
    if (saved && alive.current) { setBaseRevision(saved.revision); report('내용을 저장했어요. 선택한 채팅에 요청 문구를 직접 붙여넣어주세요.'); }
    return saved || null;
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); report('요청 문구를 복사했어요. 선택한 Codex 채팅에 직접 붙여넣어주세요. AI에 전달된 상태는 아니에요.'); }
    catch { setPromptOpen(true); setError('자동 복사를 사용할 수 없어요. 아래 요청 문구를 직접 선택해서 복사해주세요.'); }
  };
  const copyPrompt = async () => { const saved = hasUnsaved ? await saveBrief() : project; if (saved) await copy(buildIntroPrompt(saved)); };
  const restore = () => { setBrief(project?.brief || emptyBrief()); setPoints(project?.brief.points.join('\n') || ''); setStyle(project?.style || emptyStyle()); setTemplateId(project?.templateId || 'product-intro'); setBaseRevision(project?.revision || 0); setPng(null); setRenderedText(''); setFileReset(value => value + 1); report('최신 저장 내용을 불러왔어요. 저장하지 않은 편집은 지워졌어요.'); };
  const reuseStyle = async (saved: SavedIntroStyle) => {
    // Only style/template is reused. Keep the current chat's brief byte-for-byte.
    const result = await artifacts.dispatch({ operation: 'save-brief', identity, expectedRevision: baseRevision, templateId: saved.templateId, brief: draft.brief, style: saved.style });
    const next = result?.projects.find(item => identityKey(item.identity) === identityKey(identity));
    if (next && alive.current) { setStyle(next.style); setTemplateId(next.templateId); setBaseRevision(next.revision); report('스타일만 가져왔어요. 이 채팅의 내용은 그대로예요.'); }
  };
  const loadFile = async (file: File | undefined, logo: boolean) => {
    if (!file) return;
    setLocalBusy(true); setError(''); setNotice('');
    try { if (logo && file.size > 500 * 1024) throw new Error('로고 PNG는 500KB 이하로 올려주세요.'); const image = await readPng(file); if (alive.current) { if (logo) setStyle(current => ({ ...current, logoDataUrl: image.dataUrl })); else setPng({ bytes: image.bytes, name: file.name }); } }
    catch (cause) { if (alive.current) { if (!logo) setPng(null); setError(String(cause)); } }
    finally { if (alive.current) setLocalBusy(false); }
  };
  const importVersion = async () => {
    if (!png || !project || hasUnsaved) return;
    const result = await artifacts.dispatch({ ...bound, operation: 'import-version', pngBytes: png.bytes, renderedText });
    const next = result?.projects.find(item => identityKey(item.identity) === identityKey(identity));
    if (next && alive.current) { setVersionId(next.versions.at(-1)?.id || ''); setBaseRevision(next.revision); setPng(null); setRenderedText(''); setFileReset(value => value + 1); report('새 버전을 가져왔어요. 원문과 이미지를 함께 확인해주세요.'); }
  };
  const requestRevision = async (kind: ArtifactRevision['kind'], instruction: string) => {
    if (!version || !project) return;
    const result = await artifacts.dispatch({ ...bound, operation: 'request-revision', revisionRequest: { kind, instruction, baseVersionId: version.id } });
    const next = result?.projects.find(item => identityKey(item.identity) === identityKey(identity));
    if (next && alive.current) { setBaseRevision(next.revision); setBrief(next.brief); setPoints(next.brief.points.join('\n')); setStyle(next.style); setTemplateId(next.templateId); await copy(buildIntroPrompt(next)); }
  };
  const review = async (next: ArtifactReview) => { if (!version) return; const result = await artifacts.dispatch({ ...bound, operation: 'review-version', versionId: version.id, review: next }); const updated = result?.projects.find(item => identityKey(item.identity) === identityKey(identity)); if (updated && alive.current) setBaseRevision(updated.revision); };
  const saveStyle = async () => {
    if (!version || !styleName.trim()) return;
    const result = await artifacts.dispatch({ ...bound, operation: 'save-style', versionId: version.id, name: styleName.trim(), ...(editingStyleId ? { styleId: editingStyleId } : {}) });
    const updated = result?.projects.find(item => identityKey(item.identity) === identityKey(identity));
    if (result && alive.current) { if (updated) setBaseRevision(updated.revision); setStyleName(''); setEditingStyleId(''); report('확정한 스타일만 저장했어요. 원문과 대화 내용은 포함되지 않아요.'); }
  };
  const exportPng = async () => {
    if (!version) return;
    setLocalBusy(true); setError('');
    try { const path = await command<string>('artifact_export', { identity, versionId: version.id }); report(path ? `PNG를 저장했어요. ${path}` : 'PNG 저장을 취소했어요.'); }
    catch (cause) { if (alive.current) setError(String(cause)); }
    finally { if (alive.current) setLocalBusy(false); }
  };
  const applyProjectResult = (result: Awaited<ReturnType<typeof artifacts.dispatch>>) => { const updated = result?.projects.find(item => identityKey(item.identity) === identityKey(identity)); if (updated && alive.current) setBaseRevision(updated.revision); };
  return <div className="intro-editor" data-testid="intro-editor">
    {(error || notice) && <p className={error ? 'error' : 'intro-notice'} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    {baseRevision !== (project?.revision || 0) && <div className="intro-notice">저장된 자료가 바뀌었어요. 최신 내용을 불러온 뒤 편집해주세요.<button className="text-button" disabled={disabled} onClick={restore}>최신 저장 내용 불러오기</button></div>}
    <div className="intro-workspace"><section className="intro-panel intro-brief"><div className="intro-panel-heading"><span className="intro-step">01</span><div><h2>전할 내용 준비</h2><p>선택한 원문의 필요한 부분만 담아주세요.</p></div></div>
      <label className="intro-field">누구에게 전하나요?<input maxLength={80} value={brief.audience} placeholder="예: 처음 만나는 잠재 고객" onChange={event => setBrief({ ...brief, audience: event.target.value })} disabled={disabled} /></label>
      <label className="intro-field">가장 중요한 한 문장<textarea aria-label="가장 중요한 한 문장" maxLength={240} rows={2} value={brief.message} placeholder="자료를 본 사람이 기억할 메시지" onChange={event => setBrief({ ...brief, message: event.target.value })} disabled={disabled} /></label>
      <label className="intro-field">핵심 포인트<textarea aria-label="핵심 포인트" maxLength={805} rows={4} value={points} placeholder={'한 줄에 하나씩 적어주세요.\n특징, 근거, 다음 행동 등'} onChange={event => setPoints(event.target.value)} disabled={disabled} /><small>한 줄에 한 가지씩 · 최대 5개, 각 160자</small></label>{points.trim() && !validPoints && <p className="error" role="alert">핵심 포인트는 1~5개, 각 160자 이하로 입력해주세요.</p>}
      <details className="intro-details" open={Boolean(brief.sourceText)}><summary>원문 발췌와 출처</summary><label className="intro-field">출처 이름<input maxLength={160} value={brief.sourceLabel} placeholder="예: 서비스 소개서 2쪽" onChange={event => setBrief({ ...brief, sourceLabel: event.target.value })} disabled={disabled} /></label><label className="intro-field">이 자료에 필요한 원문 발췌<textarea aria-label="이 자료에 필요한 원문 발췌" maxLength={8000} rows={5} value={brief.sourceText} placeholder="대화 전체 대신 필요한 부분만 붙여넣어주세요." onChange={event => setBrief({ ...brief, sourceText: event.target.value })} disabled={disabled} /><small>{brief.sourceText.length.toLocaleString()} / 8,000자 · 전체 대화는 수집하지 않아요.</small></label></details>
      <details className="intro-details"><summary>스타일 조절</summary><fieldset className="intro-colors"><legend>색상 팔레트</legend>{style.palette.map((color, index) => <label key={index}><input aria-label={`팔레트 색상 ${index + 1}`} type="color" value={color} disabled={disabled} onChange={event => setStyle({ ...style, palette: style.palette.map((value, at) => at === index ? event.target.value : value) })} /><span>{color.toUpperCase()}</span></label>)}</fieldset><div className="intro-two-fields"><label className="intro-field">글 길이<select aria-label="글 길이" value={style.copyLength} disabled={disabled} onChange={event => setStyle({ ...style, copyLength: event.target.value as IntroStyle['copyLength'] })}><option value="short">짧게</option><option value="normal">기본</option></select></label><label className="intro-field">레이아웃<select aria-label="레이아웃" value={style.layout} disabled={disabled} onChange={event => setStyle({ ...style, layout: event.target.value as IntroStyle['layout'] })}><option value="landscape">가로형</option><option value="portrait">세로형</option></select></label></div><label className="intro-field">로고 PNG · 선택<input aria-label="로고 PNG · 선택" type="file" accept="image/png" disabled={disabled} onChange={event => void loadFile(event.target.files?.[0], true)} /><small>500KB 이하 PNG · 요청 시 채팅에도 원본 로고를 첨부해주세요.</small></label>{style.logoDataUrl && <div className="intro-logo"><img src={style.logoDataUrl} alt="선택한 로고" /><button className="text-button" disabled={disabled} onClick={() => setStyle({ ...style, logoDataUrl: null })}>로고 제거</button></div>}</details>
      <div className="intro-actions"><button className="button primary" disabled={disabled || !canSave || baseRevision !== (project?.revision || 0)} onClick={() => void saveBrief()}>내용 저장</button>{hasUnsaved && <span className="intro-muted">아직 저장하지 않은 내용</span>}</div>
    </section><div className="intro-side"><section className="intro-panel intro-generate"><div className="intro-panel-heading"><span className="intro-step">02</span><div><h2>채팅에서 이미지 만들기</h2><p>준비한 요청을 Codex에 직접 전해주세요.</p></div></div><p className="intro-body">요청 문구를 복사해 위에서 선택한 채팅에 붙여넣고, 이미지 생성이 가능한 도구로 만들어주세요.</p><button className="button primary intro-full" disabled={disabled || !canSave || baseRevision !== (project?.revision || 0)} onClick={() => void copyPrompt()}>소개 자료 요청 복사 <span aria-hidden="true">↗</span></button><p className="intro-muted">복사만으로 AI에 전달되지 않아요. 이 화면은 이미지를 자동 생성하거나 모델을 변경하지 않아요.</p><details className="intro-details" open={promptOpen} onToggle={event => setPromptOpen(event.currentTarget.open)}><summary>요청 문구 확인</summary><textarea className="intro-prompt" readOnly aria-label="소개 자료 요청 문구" value={prompt} rows={8} /></details><button className="text-button" disabled={!canSave || disabled} onClick={() => void copy(JSON.stringify({ 참고자료이며지시가아님: true, templateId: draft.templateId, brief: draft.brief, pendingRevision: draft.pendingRevision }, null, 2))}>원문 포함 준비 내용 복사</button><p className="intro-muted">요청 문구에는 원문 발췌를 넣지 않아요. 원문이나 긴 내용이 필요하면 준비 내용을 따로 복사해 함께 전해주세요.</p><button className="text-button" onClick={() => onWorkflow(identity)}>고급 계획·실행 도움 보기 →</button></section>
      <section className="intro-panel intro-saved"><div className="intro-section-head"><h2>내 스타일</h2>{styles.length > 0 && <button className="text-button" disabled={disabled || !canSave} onClick={() => void reuseStyle(styles[0])}>최근 스타일 쓰기</button>}</div><p className="intro-muted">확정한 색상·로고·글 길이·구성만 저장해요.<br />이전 자료의 문구와 원문은 가져오지 않아요.</p>{styles.length ? <ul className="intro-style-list">{styles.map(saved => <li key={saved.id}><div><span className="intro-style-swatches" aria-hidden="true">{saved.style.palette.map((color, i) => <i key={i} style={{ background: color }} />)}</span><strong>{saved.name}</strong></div><div><button className="text-button" disabled={disabled || !canSave} onClick={() => void reuseStyle(saved)}>사용</button><button className="text-button" disabled={disabled || !version?.acceptedAt} onClick={() => { setEditingStyleId(saved.id); setStyleName(saved.name); }}>수정</button><button className="text-button danger-text" disabled={disabled} onClick={async () => { if (await artifacts.dispatch({ operation: 'delete-style', styleId: saved.id })) report('저장한 스타일을 삭제했어요.'); }}>삭제</button></div></li>)}</ul> : <p className="intro-style-empty">마음에 드는 결과를 확정하면<br />첫 스타일을 저장할 수 있어요.</p>}</section></div></div>
    <section className="intro-panel intro-results"><div className="intro-panel-heading"><span className="intro-step">03</span><div><h2>결과 확인하고 저장</h2><p>생성한 PNG를 가져와 원문과 나란히 확인해요.</p><button className="text-button" disabled={disabled} onClick={() => void artifacts.refresh()}>새 결과 확인</button></div>{project && <button className="intro-favorite" aria-pressed={project.favorite} aria-label="소개 자료 즐겨찾기" disabled={disabled} onClick={async () => applyProjectResult(await artifacts.dispatch({ ...bound, operation: 'set-favorite', favorite: !project.favorite }))}>{project.favorite ? '★' : '☆'}</button>}</div>
      <div className="intro-import"><label className="intro-field">생성 결과 PNG<input aria-label="생성 결과 PNG" key={fileReset} type="file" accept="image/png" disabled={disabled || !project || hasUnsaved || project.versions.length >= 20} onChange={event => void loadFile(event.target.files?.[0], false)} /><small>{png ? png.name : '실제 PNG · 최대 5MB'}{hasUnsaved ? ' · 내용을 먼저 저장해주세요.' : project && project.versions.length >= 20 ? ' · 보관 가능한 20개 버전을 모두 사용했어요.' : ''}</small></label><label className="intro-field">이미지에 담긴 문구<textarea aria-label="이미지에 담긴 문구" rows={2} maxLength={8000} value={renderedText} disabled={disabled || !project || hasUnsaved || project.versions.length >= 20} placeholder="이미지의 문구를 직접 적거나 생성 도구의 텍스트를 붙여넣어주세요." onChange={event => setRenderedText(event.target.value)} /><small>사용자·연결 도구가 제공한 텍스트예요. OCR로 읽은 결과가 아니에요.</small></label><button className="button" disabled={disabled || !png || !renderedText.trim() || !project || hasUnsaved || project.versions.length >= 20} onClick={() => void importVersion()}>새 버전 가져오기</button></div>
      {version && project ? <><div className="intro-version-bar"><label className="intro-field">확인할 버전<select aria-label="확인할 버전" value={version.id} disabled={disabled} onChange={event => { setVersionId(event.target.value); setCompareId(''); setEditingStyleId(''); setStyleName(''); }}>{project.versions.map((item, index) => <option key={item.id} value={item.id}>버전 {index + 1} · {dateLabel(item.createdAt)}{item.acceptedAt ? ' · 확정' : ''}</option>)}</select></label><label className="intro-field">나란히 비교<select aria-label="나란히 비교" value={compareId} onChange={event => setCompareId(event.target.value)}><option value="">비교하지 않기</option>{project.versions.filter(item => item.id !== version.id).map(item => <option key={item.id} value={item.id}>버전 {project.versions.indexOf(item) + 1} · {dateLabel(item.createdAt)}</option>)}</select></label><span className="intro-stage">{version.acceptedAt ? '사용자 확정' : Object.values(version.review).every(value => value === 'pass') && blockingChecks.length === 0 ? '검토 완료' : '결과 가져옴 · 확인 필요'}</span><span className="intro-version-size">{version.width} × {version.height} px</span></div>
        <div className={`intro-version-grid ${compareVersion ? 'comparing' : ''}`}><figure><figcaption>버전 {project.versions.indexOf(version) + 1}{version.acceptedAt ? ' · 확정한 결과' : ' · 확인 중'}</figcaption><ArtifactImage identity={identity} versionId={version.id} label={`소개 자료 버전 ${project.versions.indexOf(version) + 1}`} /></figure>{compareVersion && <figure><figcaption>버전 {project.versions.indexOf(compareVersion) + 1}{compareVersion.acceptedAt ? ' · 확정한 결과' : ''}</figcaption><ArtifactImage identity={identity} versionId={compareVersion.id} label={`비교할 소개 자료 버전 ${project.versions.indexOf(compareVersion) + 1}`} /></figure>}</div>
        {project.pendingRevision && <p className="intro-notice">수정 요청이 준비돼 있어요. 수정한 PNG를 가져온 뒤 새 버전을 확정해주세요.</p>}<div className="intro-review-grid"><div><VersionBrief version={version} /><details className="intro-details"><summary>코드로 확인한 항목</summary><ul className="intro-checks">{version.checks.filter(check => check.method === 'code').map(check => <li key={check.id} data-status={check.status}><span>{check.status === 'pass' ? '✓' : check.status === 'warning' ? '!' : '○'}</span>{check.detail}</li>)}</ul><p className="intro-muted">파일·텍스트 규칙 확인이며, 이미지 속 글자와 의미를 자동 검증한 것은 아니에요.</p></details></div><div className="intro-review"><h3>이미지를 직접 확인해주세요</h3>{(Object.keys(reviewLabels) as (keyof ArtifactReview)[]).map(key => <label className="intro-review-check" key={key}><input type="checkbox" disabled={disabled || !!version.acceptedAt} checked={version.review[key] === 'pass'} onChange={event => void review({ ...version.review, [key]: event.target.checked ? 'pass' : 'pending' })} />{reviewLabels[key]}</label>)}{blockingChecks.length > 0 && <p className="error">파일 또는 원문에 없는 수치 확인이 필요해요. 수정한 PNG를 새 버전으로 가져와주세요.</p>}<div className="intro-actions"><button className="button primary" disabled={disabled || !!version.acceptedAt || !!project.pendingRevision || blockingChecks.length > 0 || Object.values(version.review).some(value => value !== 'pass')} onClick={async () => { const result = await artifacts.dispatch({ ...bound, operation: 'accept-version', versionId: version.id }); applyProjectResult(result); if (result) report('이 버전을 확정했어요. PNG로 저장하거나 스타일을 보관할 수 있어요.'); }}>{version.acceptedAt ? '확정한 버전' : '이 버전 확정'}</button><button className="button" disabled={disabled} onClick={() => void exportPng()}>PNG 저장</button></div></div></div>
        <div className="intro-revision"><h3>조금 더 다듬고 싶다면</h3><p className="intro-muted">수정 요청을 복사해 같은 채팅에 보내주세요. 다시 생성하면 글자·배치·이미지가 달라질 수 있어요.</p><div className="intro-actions">{revisionOptions.map(option => <button key={option.kind} className="button secondary" disabled={disabled || hasUnsaved} onClick={() => void requestRevision(option.kind, option.instruction)}>{option.label}</button>)}</div><label className="intro-field">추가 수정 요청<input maxLength={500} disabled={disabled} value={revisionText} onChange={event => setRevisionText(event.target.value)} placeholder="예: 마지막에 문의 방법을 더 크게 보여주세요." /></label><button className="button" disabled={disabled || hasUnsaved || !revisionText.trim()} onClick={() => void requestRevision('custom', revisionText.trim())}>수정 요청 복사</button>{project.pendingRevision && <p className="intro-muted">다음 PNG는 선택한 수정 요청의 새 버전으로 기록해요: {project.pendingRevision.instruction}</p>}</div>
        {version.acceptedAt && <div className="intro-save-style"><div><h3>{editingStyleId ? '내 스타일 수정' : '이 스타일, 다음에도 쓸까요?'}</h3><p className="intro-muted">현재 확정 버전의 스타일만 저장해요. 문구·원문·대화는 저장 스타일에 포함되지 않아요.</p></div><label className="intro-field">스타일 이름<input maxLength={60} value={styleName} disabled={disabled} placeholder="예: 차분한 세이지 소개" onChange={event => setStyleName(event.target.value)} /></label><button className="button" disabled={disabled || !styleName.trim() || (!editingStyleId && styles.length >= 20)} onClick={() => void saveStyle()}>{editingStyleId ? '스타일 변경 저장' : '스타일 저장'}</button>{editingStyleId && <button className="text-button" onClick={() => { setEditingStyleId(''); setStyleName(''); }}>수정 취소</button>}</div>}
      </> : <div className="intro-result-empty"><span aria-hidden="true">▧</span><p>아직 가져온 이미지가 없어요.</p><small>채팅에서 만든 실제 PNG가 이곳에 표시돼요.</small></div>}
    </section>
    {project && <div className="intro-project-footer"><span>이 자료는 선택한 계정·채팅에만 연결돼요.</span><button className="text-button danger-text" disabled={disabled} onClick={() => setDeleteOpen(true)}>이 소개 자료 삭제</button></div>}
    {deleteOpen && <Modal title="이 소개 자료를 삭제할까요?" close={() => { if (!disabled) setDeleteOpen(false); }}><p className="intro-body">선택한 채팅의 원문 발췌, 이미지와 모든 버전이 삭제돼요. 따로 저장한 스타일과 Codex 채팅은 남아요.</p><div className="intro-actions"><button className="button secondary" disabled={disabled} onClick={() => setDeleteOpen(false)}>취소</button><button className="button primary" disabled={disabled} onClick={async () => { if (await artifacts.dispatch({ ...bound, operation: 'delete-project' }) && alive.current) { setDeleteOpen(false); setBrief(emptyBrief()); setPoints(''); setStyle(emptyStyle()); setBaseRevision(0); setVersionId(''); setCompareId(''); setPng(null); setRenderedText(''); setFileReset(value => value + 1); report('이 채팅의 소개 자료를 삭제했어요.'); } }}>소개 자료 삭제</button></div></Modal>}
  </div>;
}

function VersionBrief({ version }: { version: ArtifactVersion }) {
  return <details className="intro-details intro-source"><summary>이 버전의 원문과 요청 · 읽기 전용</summary><dl><dt>대상</dt><dd>{version.brief.audience}</dd><dt>핵심 메시지</dt><dd>{version.brief.message}</dd><dt>핵심 포인트</dt><dd>{version.brief.points.join('\n')}</dd><dt>출처</dt><dd>{version.brief.sourceLabel || '입력하지 않음'}</dd><dt>원문 발췌</dt><dd>{version.brief.sourceText || '입력하지 않음'}</dd><dt>제공받은 이미지 문구 · OCR 아님</dt><dd>{version.renderedText || '입력하지 않음'}</dd></dl></details>;
}
