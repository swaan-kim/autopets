import React from 'react';
import { createRoot } from 'react-dom/client';
import { Pet, type PetMotion } from '../src/features/pets/Pet';
import '../src/app/style.css';
import './pet-motion-preview.css';

const motions: [PetMotion, string, string][] = [
  ['idle', '함께할 준비', '다음 할 일을 기다려요'],
  ['thinking', '계획 중', '무엇을 만들지 정리해요'],
  ['dizzy', '확인 필요', '계획을 보고 결정해 주세요'],
  ['writing', '제작 중', '맡긴 작업을 만들고 있어요'],
  ['celebrate', '완료', '채팅에서 결과를 열어보세요'],
  ['angry', '상태 확인 필요', '확인되지 않은 결과는 알려드려요'],
];
createRoot(document.getElementById('root')!).render(<main className="motion-preview">
  <header><span>AutoPets · 제작 펫</span><h1>작업의 흐름이, 펫의 모습으로.</h1><p>개발용 상태 예시입니다. 실제 작업을 실행하거나 완료한 화면이 아닙니다.</p></header>
  <section>{motions.map(([motion, label, description]) => <article key={motion}><Pet motion={motion} /><h2>{label}</h2><p>{description}</p></article>)}</section>
  <footer>사전 제작 이미지 · 실시간 3D / 실행 중 이미지 생성 없음 · 운영체제의 동작 줄이기 설정 지원</footer>
</main>);
