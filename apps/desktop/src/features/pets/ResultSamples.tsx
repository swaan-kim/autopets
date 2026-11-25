import { useId } from 'react';

// Original design examples, not AI execution evidence. Reuse the same artwork at every size.
export function ResultSample({ kind }: { kind: string }) {
  const id = 'sample' + useId().replace(/:/g, '');
  return <svg viewBox="0 0 640 400" className="result-sample-art" aria-hidden="true" data-sample-kind={kind}>
    <defs>
      <clipPath id={id + 'product'}><rect x="322" width="318" height="268" /></clipPath>
      <clipPath id={id + 'coast'}><rect width="640" height="264" /></clipPath>
      <linearGradient id={id + 'shade'} x2="0" y2="1"><stop stopColor="#183e43" stopOpacity="0" /><stop offset="1" stopColor="#16363b" stopOpacity=".72" /></linearGradient>
    </defs>
    {kind === 'daily-plan' ? <g>
      <rect width="640" height="400" fill="#f6f3ed" />
      <rect x="24" y="24" width="204" height="352" rx="18" fill="#f1dfc7" />
      <text x="48" y="65" fill="#8a6748" fontSize="12" letterSpacing="2">A LITTLE ROOM</text>
      <text x="44" y="141" fill="#4a392e" fontSize="60" fontWeight="700" letterSpacing="-4">오늘을</text>
      <text x="44" y="206" fill="#4a392e" fontSize="60" fontWeight="700" letterSpacing="-4">가볍게.</text>
      <rect x="46" y="256" width="158" height="43" rx="21" fill="#fffaf2" />
      <circle cx="68" cy="277" r="9" fill="none" stroke="#a37d56" strokeWidth="1.5" /><path d="M68 271v6l4 3" fill="none" stroke="#a37d56" strokeWidth="1.5" />
      <text x="86" y="282" fill="#785a3d" fontSize="15">여유 25분</text>
      <text x="48" y="347" fill="#886e55" fontSize="12">꼭 필요한 일부터, 하나씩.</text>
      <text x="257" y="60" fill="#39413a" fontSize="21" fontWeight="650">오늘의 세 가지</text>
      {[
        { y: 84, title: '초안 마무리', time: '09:00 · 집중하는 시간', done: true },
        { y: 184, title: '장보기', time: '10:30 · 필요한 것만', done: false },
        { y: 284, title: '20분 산책', time: '11:15 · 나를 위한 여유', done: false },
      ].map(({ y, title, time, done }, index) => <g key={title}>
        <rect x="252" y={y} width="364" height="82" rx="13" fill="#fffefa" stroke="#e7e5dc" />
        <circle cx="281" cy={y + 32} r="11" fill={done ? '#72856d' : '#fffefa'} stroke={done ? '#72856d' : '#d0d5cb'} strokeWidth="1.5" />
        {done ? <path d={`m276 ${y + 32} 4 4 7-8`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" /> : <text x="277" y={y + 36} fill="#8b9786" fontSize="11">{index + 1}</text>}
        <text x="307" y={y + 35} fill="#3c493b" fontSize="20" fontWeight="600">{title}</text>
        <text x="307" y={y + 60} fill="#899082" fontSize="12">{time}</text>
      </g>)}
    </g> : kind === 'travel-plan' ? <g>
      <rect width="640" height="400" fill="#edf4f3" />
      <image href="/assets/prompt-gallery-v1/coast.webp" width="640" height="264" preserveAspectRatio="xMidYMid slice" clipPath={'url(#' + id + 'coast)'} />
      <rect width="640" height="264" fill={'url(#' + id + 'shade)'} />
      <text x="34" y="43" fill="#f5fcfa" fontSize="12" letterSpacing="3">SLOW TRAVEL</text>
      <text x="32" y="166" fill="#fff" fontSize="45" fontWeight="650" letterSpacing="-2">바다 곁의 하루.</text>
      <text x="35" y="198" fill="#eef8f4" fontSize="15">걷고, 쉬고, 풍경을 담는 작은 여행.</text>
      <rect x="22" y="232" width="596" height="146" rx="16" fill="#fffefa" />
      <path d="M74 271h488" stroke="#d7e5df" strokeWidth="3" />
      {[{ x: 75, time: '10:00', title: '바다 산책', note: '느긋하게 해변 한 바퀴' }, { x: 268, time: '12:00', title: '동네 카페', note: '풍경을 보며 쉬어가기' }, { x: 461, time: '17:00', title: '노을 보기', note: '해 질 무렵 전망대' }].map(({ x, time, title, note }) => <g key={time}>
        <circle cx={x} cy="271" r="7" fill="#547d71" stroke="#fffefa" strokeWidth="3" />
        <text x={x - 29} y="300" fill="#84968e" fontSize="12">{time}</text>
        <text x={x - 29} y="330" fill="#35574e" fontSize="21" fontWeight="600">{title}</text>
        <text x={x - 29} y="354" fill="#89998f" fontSize="11">{note}</text>
      </g>)}
    </g> : kind === 'study-helper' ? <g>
      <rect width="640" height="400" fill="#edf2fa" />
      <rect x="24" y="24" width="592" height="352" rx="17" fill="#fff" />
      <text x="47" y="59" fill="#8192b1" fontSize="11" letterSpacing="2">ONE CONCEPT, CLEARLY.</text>
      <text x="44" y="116" fill="#263c60" fontSize="43" fontWeight="700" letterSpacing="-2">기회비용</text>
      <text x="47" y="144" fill="#7a88a0" fontSize="15">선택하지 않은, 가장 좋은 대안의 가치.</text>
      <rect x="44" y="170" width="260" height="120" rx="12" fill="#ecf1fa" />
      <rect x="324" y="170" width="272" height="120" rx="12" fill="#f5f3ed" />
      <text x="62" y="199" fill="#8091ae" fontSize="12">내가 고른 것</text>
      <text x="62" y="239" fill="#375682" fontSize="28" fontWeight="650">책 읽기</text>
      <path d="M228 214q15-6 29 0v37q-14-6-29 0-15-6-29 0v-37q14-6 29 0v37" fill="#d6e1f4" stroke="#819cc5" strokeWidth="2" strokeLinejoin="round" />
      <text x="344" y="199" fill="#a29780" fontSize="12">포기한 가장 좋은 대안</text>
      <text x="344" y="239" fill="#6c6049" fontSize="28" fontWeight="650">영화 보기</text>
      <rect x="526" y="214" width="47" height="35" rx="4" fill="#e8e0cf" stroke="#b5a58a" strokeWidth="2" /><path d="m543 223 13 8-13 8z" fill="#b5a58a" />
      <path d="M303 230h21m-7-6 7 6-7 6" fill="none" stroke="#a7b5ca" strokeWidth="2" />
      <circle cx="60" cy="329" r="13" fill="#eaf0fb" /><text x="54" y="334" fill="#5874a4" fontSize="15" fontWeight="650">Q</text>
      <text x="84" y="334" fill="#576b89" fontSize="16">이 선택의 기회비용은 무엇일까요?</text>
      <text x="48" y="359" fill="#a0a9b8" fontSize="11">개념 정리 → 비교 예시 → 확인 문제</text>
    </g> : kind === 'review-helper' ? <g>
      <rect width="640" height="400" fill="#eef1f8" />
      <rect x="24" y="24" width="592" height="352" rx="17" fill="#fff" />
      <text x="47" y="59" fill="#7f8fb0" fontSize="11" letterSpacing="2">ASK AGAIN, RIGHT BEFORE YOU FORGET.</text>
      <text x="47" y="96" fill="#8a96ab" fontSize="15">다음 복습</text>
      <text x="44" y="150" fill="#2c3f7a" fontSize="50" fontWeight="700" letterSpacing="-2">3일 뒤</text>
      <text x="47" y="180" fill="#7a88a0" fontSize="15">잊을 때쯤 틀린 문제부터 다시 물어봐요.</text>
      <path d="M66 246h468" stroke="#c9d3f2" strokeWidth="3" />
      {([[66, '오늘', true], [196, '3일 뒤', true], [356, '7일 뒤', false], [534, '16일 뒤', false]] as const).map(([x, label, done]) => <g key={label}>
        <circle cx={x} cy="246" r="11" fill={done ? '#5b7bd5' : '#fff'} stroke="#5b7bd5" strokeWidth="3" />
        <text x={x} y="282" fill={done ? '#2c3f7a' : '#8a96ab'} fontSize="14" fontWeight="650" textAnchor="middle">{label}</text>
      </g>)}
      <rect x="44" y="312" width="132" height="34" rx="17" fill="#5b7bd5" /><text x="110" y="334" fill="#fff" fontSize="14" fontWeight="650" textAnchor="middle">틀린 문제 먼저</text>
      <rect x="188" y="312" width="146" height="34" rx="17" fill="#eef2ff" /><text x="261" y="334" fill="#2c3f7a" fontSize="14" fontWeight="650" textAnchor="middle">문제 묶음 · 10문제</text>
      <text x="596" y="334" fill="#a0a9b8" fontSize="11" textAnchor="end">풀이와 채점은 Codex 채팅에서</text>
    </g> : kind === 'marketing-copy' ? <g>
      <rect width="640" height="400" fill="#f5efe5" />
      <image href="/assets/prompt-gallery-v1/product.webp" x="322" width="318" height="268" preserveAspectRatio="xMidYMid slice" clipPath={'url(#' + id + 'product)'} />
      <text x="31" y="39" fill="#6f7c60" fontSize="11" letterSpacing="2">MORI / CAMPAIGN COPY</text>
      <text x="29" y="100" fill="#344e3d" fontSize="40" fontWeight="650" letterSpacing="-2">일상에,</text>
      <text x="29" y="151" fill="#344e3d" fontSize="40" fontWeight="650" letterSpacing="-2">작은 초록.</text>
      <text x="32" y="184" fill="#88917b" fontSize="14">당신의 하루를 위한 새로운 루틴.</text>
      <rect x="31" y="212" width="195" height="33" rx="16" fill="#3c5844" /><text x="49" y="234" fill="#fffdf4" fontSize="13">새로운 루틴 만나기　↗</text>
      {[{ x: 24, tag: '짧고 명확하게', copy: '가벼운 하루의 시작.' }, { x: 226, tag: '감성을 담아서', copy: '오늘도, 작은 초록을.' }, { x: 428, tag: '버튼 문구', copy: '새로운 루틴 만나기' }].map(({ x, tag, copy }) => <g key={tag}>
        <rect x={x} y="286" width="188" height="89" rx="10" fill="#fffdf8" stroke="#e6e1d4" />
        <text x={x + 14} y="311" fill="#929980" fontSize="11">{tag}</text>
        <text x={x + 14} y="342" fill="#495c42" fontSize="16" fontWeight="600">{copy}</text>
      </g>)}
    </g> : kind === 'presentation' ? <g>
      <rect width="640" height="400" fill="#eef0ec" />
      {[36, 119, 202].map((y, index) => <g key={y}>
        <rect x="20" y={y} width="94" height="67" rx="5" fill={index === 0 ? '#f1ddba' : '#fffefa'} stroke={index === 0 ? '#d0a76e' : '#dce0d7'} strokeWidth={index === 0 ? '2' : '1'} />
        <text x="29" y={y + 18} fill="#8e8c7e" fontSize="9">0{index + 1}</text>
        {index === 0 ? <><path d={`M31 ${y + 34}h58m-58 9h42`} stroke="#876e50" strokeWidth="4" /></> : index === 1 ? <><rect x="33" y={y + 33} width="12" height="20" rx="2" fill="#b0c7a3" /><rect x="50" y={y + 26} width="12" height="27" rx="2" fill="#8aa680" /><rect x="67" y={y + 19} width="12" height="34" rx="2" fill="#65815e" /></> : <><circle cx="45" cy={y + 40} r="12" fill="#ebd9b9" /><path d={`M65 ${y + 34}h31m-31 10h23`} stroke="#d3d9ca" strokeWidth="4" /></>}
      </g>)}
      <rect x="137" y="36" width="481" height="301" rx="7" fill="#fffdf7" stroke="#dde0d7" />
      <text x="164" y="75" fill="#9a927e" fontSize="10" letterSpacing="2">CONTENTS / 2026</text>
      <text x="160" y="139" fill="#354838" fontSize="33" fontWeight="650" letterSpacing="-1.5">작은 팀의</text>
      <text x="160" y="182" fill="#354838" fontSize="33" fontWeight="650" letterSpacing="-1.5">콘텐츠 운영 제안</text>
      <text x="164" y="216" fill="#90947e" fontSize="14">조사부터 제작, 배포까지.</text>
      <g transform="translate(469 232)">
        <circle cx="49" cy="15" r="60" fill="#f4e5c9" />
        <rect x="3" y="3" width="21" height="51" rx="4" fill="#c5d2b8" /><rect x="32" y="-15" width="21" height="69" rx="4" fill="#91a97d" /><rect x="61" y="-36" width="21" height="90" rx="4" fill="#55714c" />
      </g>
      <path d="M164 274h230" stroke="#dddccc" /><text x="164" y="300" fill="#8c957d" fontSize="11">01 현황　　02 운영　　03 실행</text>
      <text x="147" y="370" fill="#7d8876" fontSize="12">콘텐츠 운영 제안</text><text x="566" y="370" fill="#7d8876" fontSize="12">1 / 5</text>
    </g> : <g>
      <rect width="640" height="400" fill="#f2f2ef" />
      <rect x="32" y="32" width="576" height="336" rx="18" fill="#fffefa" />
      <text x="62" y="90" fill="#8f998d" fontSize="13" letterSpacing="2">A SCENE TO START WITH</text>
      <text x="59" y="158" fill="#3d5145" fontSize="36" fontWeight="650">원하는 장면을 한 줄로.</text>
      <text x="62" y="197" fill="#879383" fontSize="17">주인공, 분위기, 빛을 함께 정리해요.</text>
      {['주인공', '배경', '분위기'].map((text, index) => <g key={text}><rect x={62 + index * 168} y="260" width="150" height="56" rx="12" fill="#edf1e7" /><text x={104 + index * 168} y="295" fill="#728167" fontSize="18">{text}</text></g>)}
    </g>}
  </svg>;
}
