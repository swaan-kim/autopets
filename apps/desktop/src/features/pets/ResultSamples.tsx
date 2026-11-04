import { useId } from 'react';

// Authored design samples. They do not report skill execution or user results.
export function ResultSample({ kind }: { kind: string }) {
  const id = 'sample' + useId().replace(/:/g, '');
  return <svg viewBox="0 0 640 400" className="result-sample-art" aria-hidden="true" data-sample-kind={kind}>
    <defs>
      <clipPath id={id + 'photo'}><rect x="280" width="360" height="400" /></clipPath>
      <clipPath id={id + 'coast'}><rect width="640" height="230" /></clipPath>
      <linearGradient id={id + 'shade'} x2="0" y2="1"><stop stopColor="#1c312d" stopOpacity="0" /><stop offset="1" stopColor="#182e29" stopOpacity=".75" /></linearGradient>
      <linearGradient id={id + 'mint'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b4d6bf" /><stop offset="1" stopColor="#6e9e87" /></linearGradient>
    </defs>
    {kind === 'marketing-copy' ? <g>
      <rect width="640" height="400" fill="#f4eee3" />
      <image href="/assets/prompt-gallery-v1/product.webp" x="280" width="360" height="400" preserveAspectRatio="xMidYMid slice" clipPath={'url(#' + id + 'photo)'} />
      <text x="34" y="65" fill="#344e3d" fontFamily="Georgia, serif" fontSize="46">mori</text>
      <path d="M35 89h205" stroke="#c9c9b8" />
      <text x="35" y="117" fill="#7c8271" fontSize="11" letterSpacing="2">A LITTLE GREEN, EVERY DAY.</text>
      <text x="35" y="223" fill="#344e3d" fontSize="23" fontWeight="400">조금 더 가벼운</text>
      <text x="33" y="267" fill="#344e3d" fontSize="37" fontWeight="650" letterSpacing="-2">매일의 시작.</text>
      <text x="35" y="303" fill="#7d806f" fontSize="14">당신의 하루에, 작은 초록을.</text>
      <rect x="35" y="337" width="174" height="32" rx="16" fill="#344e3d" />
      <text x="52" y="358" fill="#fffdf4" fontSize="12">mori와 함께 시작하기</text><path d="M185 348l5 5-5 5m-7-5h12" fill="none" stroke="#fffdf4" strokeWidth="1.5" />
    </g> : kind === 'presentation' ? <g>
      <rect width="640" height="400" fill="#172d2c" />
      <path d="M409 0v400M497 0v400M585 0v400M380 77h260M380 165h260M380 253h260M380 341h260" stroke="#abc4b0" strokeOpacity=".08" />
      <text x="36" y="42" fill="#c2d0c2" fontSize="10" letterSpacing="2.5">MARKETING OPERATIONS / 2026</text>
      <text x="35" y="141" fill="#f4f0df" fontSize="41" fontWeight="600" letterSpacing="-2">작은 팀의</text>
      <text x="35" y="193" fill="#f4f0df" fontSize="41" fontWeight="600" letterSpacing="-2">콘텐츠 운영 제안</text>
      <path d="M37 218h44" stroke="#adcfad" strokeWidth="3" />
      <text x="36" y="252" fill="#b5c5b8" fontSize="15">조사부터 제작, 배포까지.</text>
      <text x="36" y="277" fill="#b5c5b8" fontSize="15">작은 팀이 함께 쓰는 하나의 흐름.</text>
      <g transform="translate(455 225) rotate(-12)">
        <rect x="-25" y="9" width="151" height="95" rx="6" fill="#496d60" />
        <rect x="-13" y="-8" width="151" height="95" rx="6" fill="#789c85" />
        <rect y="-25" width="151" height="95" rx="6" fill={'url(#' + id + 'mint)'} />
        <rect x="17" y="-7" width="34" height="5" rx="2" fill="#294d40" opacity=".65" />
        <rect x="17" y="13" width="24" height="33" rx="3" fill="#e4ecdb" /><rect x="51" y="3" width="24" height="43" rx="3" fill="#f0f2df" /><rect x="85" y="-7" width="24" height="53" rx="3" fill="#f8f7e6" />
      </g>
      <path d="M36 346h568" stroke="#8ba895" strokeOpacity=".25" />
      <text x="36" y="373" fill="#a0b8a7" fontSize="10" letterSpacing="1">01 현황 정리　 /　02 운영 설계　 /　03 실행 계획</text>
      <text x="585" y="373" fill="#d4e3d0" fontSize="11">01</text>
    </g> : kind === 'daily-plan' ? <g>
      <rect width="640" height="400" fill="#eeeee5" />
      <rect x="27" y="24" width="586" height="352" rx="12" fill="#fffef8" />
      <text x="53" y="65" fill="#969e8d" fontSize="10" letterSpacing="2">YOUR DAY, WITH A LITTLE ROOM.</text>
      <text x="51" y="114" fill="#3e4b3a" fontSize="34" fontWeight="650" letterSpacing="-1.5">오늘을 가볍게.</text>
      <text x="53" y="143" fill="#8f9685" fontSize="13">꼭 필요한 세 가지, 그리고 나를 위한 시간.</text>
      <path d="M53 164h534M398 187v153" stroke="#e4e7db" />
      <g fill="#4d5845" fontSize="18"><text x="88" y="213">초안 마무리</text><text x="88" y="263">장보기</text><text x="88" y="313">20분 산책</text></g>
      <circle cx="65" cy="207" r="9" fill="#72836b" /><path d="m61 207 3 3 5-6" fill="none" stroke="#fffef6" strokeWidth="1.8" /><circle cx="65" cy="257" r="9" fill="none" stroke="#ced5c4" strokeWidth="1.5" /><circle cx="65" cy="307" r="9" fill="none" stroke="#ced5c4" strokeWidth="1.5" />
      <text x="457" y="210" fill="#8b9580" fontSize="12">작은 루틴</text><circle cx="491" cy="267" r="33" fill="none" stroke="#edf0e5" strokeWidth="7" /><path d="M491 234a33 33 0 0 1 29 49" fill="none" stroke="#93a57f" strokeWidth="7" strokeLinecap="round" /><text x="477" y="274" fill="#697a58" fontSize="20">1/3</text><text x="450" y="327" fill="#9aa28e" fontSize="11">조금씩, 꾸준히.</text>
    </g> : kind === 'travel-plan' ? <g>
      <rect width="640" height="400" fill="#fffdf7" />
      <image href="/assets/prompt-gallery-v1/coast.webp" width="640" height="230" preserveAspectRatio="xMidYMid slice" clipPath={'url(#' + id + 'coast)'} />
      <rect width="640" height="230" fill={'url(#' + id + 'shade)'} />
      <text x="35" y="49" fill="#fffbec" fontSize="10" letterSpacing="2.8">SLOW TRAVEL / ONE DAY</text>
      <text x="34" y="181" fill="#fffdf2" fontSize="37" fontWeight="600" letterSpacing="-1.5">바다 곁의 하루.</text>
      <text x="36" y="207" fill="#e2e4d3" fontSize="12">서두르지 않아도 충분한 여행.</text>
      <path d="M52 280v67" stroke="#d4dcc9" strokeWidth="2" /><circle cx="52" cy="280" r="5" fill="#779881" /><circle cx="52" cy="344" r="5" fill="#9eb296" />
      <text x="77" y="285" fill="#3f5649" fontSize="20" fontWeight="550">바다 산책</text><text x="77" y="309" fill="#9aa28f" fontSize="12">10:00　느긋하게 해변 한 바퀴</text><text x="77" y="350" fill="#3f5649" fontSize="20" fontWeight="550">풍경이 좋은 카페</text><text x="77" y="374" fill="#9aa28f" fontSize="12">12:00　쉬어가는 점심시간</text>
      <text x="460" y="295" fill="#a3b19d" fontSize="11" letterSpacing="1">LESS RUSH.</text><text x="460" y="317" fill="#a3b19d" fontSize="11" letterSpacing="1">MORE MOMENTS.</text>
    </g> : <g>
      <rect width="640" height="400" fill="#f1ece4" /><rect x="27" y="24" width="586" height="352" rx="7" fill="#fffef8" />
      <path d="M63 74h514" stroke="#e5dfd2" /><text x="64" y="59" fill="#8e8c7b" fontSize="10" letterSpacing="2">A NOTE FOR UNDERSTANDING</text><text x="550" y="59" fill="#9b9988" fontSize="10">01</text>
      <text x="62" y="136" fill="#344940" fontSize="40" fontWeight="650" letterSpacing="-1">기회비용</text>
      <text x="64" y="178" fill="#7a8476" fontSize="17">선택하지 않은 가장 좋은 대안의 가치.</text>
      <path d="M64 203h513" stroke="#e5dfd2" />
      <rect x="63" y="229" width="230" height="103" rx="8" fill="#eaf0e4" /><rect x="318" y="229" width="260" height="103" rx="8" fill="#f6f2e9" />
      <text x="82" y="258" fill="#87967b" fontSize="11">내가 고른 것</text><text x="82" y="296" fill="#4b6245" fontSize="23" fontWeight="550">책 읽기</text>
      <text x="337" y="258" fill="#a49881" fontSize="11">포기한 대안</text><text x="337" y="296" fill="#7b705f" fontSize="23" fontWeight="550">영화 보기</text>
      <text x="64" y="356" fill="#9e9f8b" fontSize="11">한 개념을 정의, 비교, 예시로 정리했어요.</text>
    </g>}
  </svg>;
}
