import { useState } from 'react';
import { DEFAULT_PET_SETTINGS, PEEK_SECONDS, requestPetSettingsTry, usePetSettings, type AlertKind, type DockedAlert, type Entrance, type PetSettings } from '../pets/petSettings';
import './pet-settings.css';

// 설정 → 펫 설정. Each choice is saved at once on this PC and reaches every floating pet right away.
const DOCKED: [DockedAlert, string, string][] = [
  ['jump', '뛰어나와서 알려주기', '펫이 나와서 말풍선을 보여주고, 그대로 화면에 있어요.'],
  ['peek', '잠깐 나왔다 다시 숨기', '말풍선을 보여준 뒤, 건드리지 않으면 원래 자리로 들어가요.'],
  ['badge', '숨은 채로 표시만', '펫은 나오지 않고, 손잡이에 ✓ · ? 표시만 붙어요.'],
];
const KINDS: [AlertKind, string, string][] = [
  ['done', '작업이 끝났을 때', 'Codex나 펫이 맡긴 일을 끝내면'],
  ['ask', '확인이 필요할 때', 'Codex가 내 답이나 승인을 기다리면'],
  ['review', '복습할 문제가 생겼을 때', '복습 도우미에 오늘 풀 문제가 있으면'],
];
const ENTRANCES: [Entrance, string, string][] = [
  ['bounce', '통통 튀어나오기', '살짝 뛰어올랐다가 내려앉아요.'],
  ['slide', '조용히 미끄러지기', '손잡이를 눌렀을 때처럼 옆으로 나와요.'],
];

function Preview({ mode }: { mode: DockedAlert }) {
  return <span className={`pet-settings-preview ${mode}`} aria-hidden="true">
    <span className="edge" /><span className="pet" />{mode !== 'badge' && <span className="bubble">완료!</span>}{mode === 'badge' && <span className="badge">✓</span>}
    {mode === 'peek' && <span className="back">↩</span>}
  </span>;
}

export function PetSettingsPanel() {
  const [settings, save] = usePetSettings();
  const [notice, setNotice] = useState('');
  const update = (next: PetSettings) => { save(next); setNotice('저장했어요. 펫에 바로 적용돼요.'); };
  const alerts = settings.dockedAlert !== 'badge';
  const isDefault = JSON.stringify(settings) === JSON.stringify(DEFAULT_PET_SETTINGS);
  return <section className="assistance-page pet-settings-page" aria-label="펫 설정">
    <div className="page-heading"><span className="eyebrow">MY PET, MY WAY</span><h1>펫이 어떻게 알려줄지<br />내 마음대로 정해요.</h1><p>바꾸면 바로 저장되고, 떠 있는 펫에 곧바로 적용돼요.</p></div>
    {notice && <p className="assistance-notice" role="status">{notice}</p>}

    <section className="assistance-card" aria-labelledby="pet-settings-docked">
      <div className="block-heading"><div><h2 id="pet-settings-docked">숨어 있을 때 알림이 오면</h2><p className="small-note">펫을 화면 가장자리로 끌어 넣거나 "숨기기"를 누르면 손잡이로 숨어요.</p></div></div>
      <fieldset className="mode-fieldset"><legend>펫의 반응</legend><div className="preference-choices">
        {DOCKED.map(([value, title, subtitle]) => <label key={value} className={`mode-option pet-settings-choice ${settings.dockedAlert === value ? 'selected' : ''}`}>
          <input type="radio" name="pet-docked-alert" value={value} checked={settings.dockedAlert === value} onChange={() => update({ ...settings, dockedAlert: value })} />
          <span><Preview mode={value} /><strong>{title}</strong><small>{subtitle}</small></span>
        </label>)}
      </div></fieldset>
      {settings.dockedAlert === 'peek' && <fieldset className="mode-fieldset"><legend>다시 숨기까지</legend><div className="pet-settings-segments" role="radiogroup" aria-label="다시 숨기까지">
        {PEEK_SECONDS.map(seconds => <label key={seconds} className={settings.peekSeconds === seconds ? 'selected' : ''}><input type="radio" name="pet-peek-seconds" checked={settings.peekSeconds === seconds} onChange={() => update({ ...settings, peekSeconds: seconds })} />{seconds}초</label>)}
      </div><p className="small-note">그 사이에 펫이나 말풍선에 마우스를 올리면 숨지 않고 기다려요.</p></fieldset>}
      <fieldset className="mode-fieldset" disabled={!alerts}><legend>이럴 때 나와요</legend>
        {KINDS.map(([kind, title, subtitle]) => <label key={kind} className="assistance-toggle"><span><strong>{title}</strong><small>{subtitle}</small></span>
          <input type="checkbox" aria-label={title} checked={settings.alertOn[kind]} onChange={event => update({ ...settings, alertOn: { ...settings.alertOn, [kind]: event.target.checked } })} /></label>)}
        {!alerts && <p className="small-note">"숨은 채로 표시만"에서는 펫이 나오지 않아요.</p>}
      </fieldset>
      <fieldset className="mode-fieldset" disabled={!alerts}><legend>나오는 모습</legend><div className="preference-choices two">
        {ENTRANCES.map(([value, title, subtitle]) => <label key={value} className={`mode-option ${settings.entrance === value ? 'selected' : ''}`}>
          <input type="radio" name="pet-entrance" value={value} checked={settings.entrance === value} onChange={() => update({ ...settings, entrance: value })} /><span><strong>{title}</strong><small>{subtitle}</small></span>
        </label>)}
      </div></fieldset>
      <div className="pet-settings-try"><button type="button" className="button secondary" disabled={!alerts} onClick={() => { requestPetSettingsTry(); setNotice('숨어 있는 펫이 있으면 지금 설정대로 나와요.'); }}>숨은 펫으로 시험해보기</button><span className="small-note">숨어 있는 펫이 없으면 아무 일도 일어나지 않아요.</span></div>
    </section>

    <section className="assistance-card" aria-labelledby="pet-settings-out">
      <div className="block-heading"><div><h2 id="pet-settings-out">화면에 나와 있을 때</h2></div></div>
      <label className="assistance-toggle"><span><strong>새 알림 말풍선 자동으로 띄우기</strong><small>끄면 펫 위의 ✓ · ? 표시에 마우스를 올리거나 눌러야 보여요.</small></span>
        <input type="checkbox" aria-label="새 알림 말풍선 자동으로 띄우기" checked={settings.bubbleWhenOut} onChange={event => update({ ...settings, bubbleWhenOut: event.target.checked })} /></label>
    </section>

    <div className="pet-settings-footer"><span className="small-note">이 PC에만 저장돼요. 채팅이나 작업 내용은 저장하지 않아요.</span><button type="button" className="text-button" disabled={isDefault} onClick={() => { save(DEFAULT_PET_SETTINGS); setNotice('기본 설정으로 되돌렸어요.'); }}>기본값으로 되돌리기</button></div>
  </section>;
}
