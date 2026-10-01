import type { ReactNode } from 'react';
import { isDesktop } from '../bridge/command';

export type ManagerSection = 'pets' | 'connection' | 'assistance' | 'intro' | 'roles';
const sectionNames: Record<ManagerSection, string> = { pets: '나의 펫', connection: '연결 설정', assistance: '자동 도움', intro: '소개 자료', roles: '역할과 내 펫' };
function NavigationIcon({ section }: { section: ManagerSection }) {
  const paths: Record<ManagerSection, ReactNode> = {
    pets: <><path d="M4 11 12 4l8 7v9H4z" /><path d="M9 20v-6h6v6" /></>,
    connection: <><path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1) scale(.9)" /></>,
    assistance: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />,
    intro: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    roles: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  };
  return <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[section]}</svg>;
}
export function AppShell({ settings, bound, disconnected, busy, error, onNavigate, onQuit, children, dialogs }: { settings: ManagerSection; bound: number; disconnected: boolean; busy: boolean; error: string; onNavigate: (section: ManagerSection) => void; onQuit: () => void; children: ReactNode; dialogs: ReactNode }) {
  const navigation = (section: ManagerSection) => <button key={section} className={`nav-item ${settings === section ? 'active' : ''}`} aria-label={sectionNames[section]} aria-current={settings === section ? 'page' : undefined} onClick={() => onNavigate(section)}><NavigationIcon section={section} /><span className="nav-text">{sectionNames[section]}</span>{section === 'pets' && bound > 0 && <span className="nav-count" aria-label={`연결한 펫 ${bound}마리`}>{bound}</span>}</button>;
  return <div className="app-shell">
    <a className="skip-to-content" href="#main-content">본문으로 건너뛰기</a>
    <aside className="sidebar">
      <div className="brand brand-logo-lockup"><img className="brand-logo" src="/assets/brand/autopets-logo.svg" alt="AutoPets" width="160" height="37" /><span className="brand-sub">내 일에 맞는 작은 동료</span></div>
      <nav aria-label="앱 메뉴"><div className="nav-label">WORKSPACE</div>{navigation('pets')}{navigation('connection')}<details className="nav-advanced"><summary>더 보기</summary>{navigation('assistance')}{navigation('intro')}{navigation('roles')}</details></nav>
      <div className="sidebar-bottom"><div className="sidebar-local"><span className="local-indicator" />이 PC에 저장돼요</div><button className="text-button" disabled={!isDesktop || busy} onClick={onQuit}>AutoPets 종료</button><span className="version">AutoPets · 0.1</span></div>
    </aside>
    <main className="main-content" id="main-content" tabIndex={-1}>
      <header className="topbar"><span>{sectionNames[settings]}</span><span className={`connection-pill ${disconnected ? 'offline' : ''}`} title="AutoPets 앱 상태입니다. Codex 채팅 연결은 각 펫에서 확인해요."><i />{!isDesktop ? '미리보기 · 연결 없음' : disconnected ? '앱 연결 확인 필요' : '앱 실행 중'}</span></header>
      {error && <div className="error" role="alert">{error}</div>}{children}
    </main>{dialogs}
  </div>;
}
