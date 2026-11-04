import { useId } from 'react';

export function PromptArtwork({ kind, large = false }: { kind: string; large?: boolean }) {
  const id = useId().replace(/:/g, '');
  const video = kind === 'coast' || kind === 'orbit';
  return <div className={`ux-art ux-art-${kind} ${large ? 'ux-art-large' : ''}`} data-evidence="design-example">
    <svg viewBox="0 0 480 320" role="img" aria-label={`${video ? '영상의 구도와 움직임' : '이미지의 구도'}을 보여주는 직접 그린 디자인 예시`}>
      <defs><linearGradient id={`${id}sky`} x2="0" y2="1"><stop stopColor="#f4cbaa" /><stop offset="1" stopColor="#f8e5cd" /></linearGradient><radialGradient id={`${id}light`}><stop stopColor="#fffef5" /><stop offset="1" stopColor="#e7e6d9" /></radialGradient></defs>
      {kind === 'product' || kind === 'orbit' ? <>
        <rect width="480" height="320" fill={kind === 'orbit' ? '#efe9e2' : '#e8e9df'} /><path d="M-20 260 295 25h105L80 320H-20" fill="#fffdf6" opacity=".48" />
        <ellipse cx="250" cy="275" rx="107" ry="15" fill="#777d65" opacity=".15" />
        <g className="ux-art-subject"><rect x="179" y="115" width="112" height="153" rx="23" fill="#6c8062" /><rect x="202" y="79" width="66" height="46" rx="9" fill="#364835" /><rect x="190" y="162" width="90" height="65" rx="2" fill="#f5f2e7" /><text x="235" y="190" textAnchor="middle" fill="#354a38" fontSize="22" fontFamily="Georgia">mori</text><path d="M215 205h40m-31 9h22" stroke="#9caa8a" strokeWidth="2" /><path d="M187 139v94" stroke="#c1cdae" strokeWidth="5" opacity=".5" strokeLinecap="round" /></g>
      </> : kind === 'coast' ? <>
        <rect width="480" height="320" fill={`url(#${id}sky)`} /><circle cx="325" cy="105" r="35" fill="#fff1cc" />
        <g className="ux-art-scene"><path d="M0 155q140-12 270 0t250-8v173H0" fill="#8ba8a2" /><path d="M-10 212q150-10 310 28t200 14v66H-10" fill="#d8c3a6" /><path d="M-10 208q150-10 310 28t200 14" fill="none" stroke="#f4eee0" strokeWidth="8" /><path d="m0 163 118-58 84 55" fill="#7d9184" opacity=".7" /></g>
      </> : kind === 'poster' ? <>
        <rect width="480" height="320" fill="#e4cdb7" /><g transform="rotate(-7 240 160)"><rect x="112" y="-14" width="256" height="352" fill="#f9f3e5" /><text x="137" y="46" fontSize="10" fill="#52674c" letterSpacing="2">A LITTLE TIME FOR YOURSELF</text><text x="133" y="129" fill="#334c35" fontSize="56" fontFamily="Georgia">SLOW</text><text x="133" y="183" fill="#334c35" fontSize="51" fontFamily="Georgia">SUNDAY</text><circle cx="285" cy="246" r="39" fill="#cf8a61" /><path d="M139 235h76m-76 12h60m-60 12h68" stroke="#7b8c6c" strokeWidth="3" /><text x="139" y="302" fill="#52674c" fontSize="10">NOV 08 · OPEN GARDEN</text></g>
      </> : kind === 'web' ? <>
        <rect width="480" height="320" fill="#e7e9e3" /><rect x="35" y="29" width="410" height="288" rx="8" fill="#fbfaf5" /><path d="M35 58h410" stroke="#e0e2d8" /><circle cx="50" cy="44" r="3" fill="#c6b7a2" /><path d="M68 44h37m260 0h22m14 0h25" stroke="#9baf98" strokeWidth="4" /><text x="67" y="108" fill="#718363" fontSize="10" letterSpacing="2">MAKE A LITTLE ROOM</text><text x="65" y="151" fill="#304b38" fontSize="35" fontFamily="Georgia">Meet in the garden.</text><path d="M68 175h164m-164 12h132" stroke="#b2bba5" strokeWidth="4" /><rect x="66" y="210" width="100" height="29" rx="14" fill="#3b573e" /><rect x="290" y="177" width="121" height="114" rx="60" fill="#d6b286" /><path d="M351 283v-75m0 37-29-24m29 7 25-22" stroke="#6e8058" strokeWidth="4" />
      </> : <>
        <rect width="480" height="320" fill="#e9eee2" /><circle cx="345" cy="75" r="32" fill="#f8df9a" /><path d="M0 176q122-89 254-18t226-10v172H0" fill="#9aaf7f" /><path d="M0 251q151-117 480-19v88H0" fill="#647e52" /><g transform="translate(192 130)"><path d="m0 38 45-32 45 32v55H0" fill="#eee2be" /><path d="m-7 40 52-42 52 42" fill="#9c6248" /><rect x="35" y="57" width="21" height="36" rx="9" fill="#647259" /><rect x="10" y="52" width="15" height="18" fill="#9fbdba" /></g><path d="m240 223 46 97h45l-74-97" fill="#c6c099" />
      </>}
    </svg>
    {video && <span className="ux-art-play" aria-hidden="true">▷</span>}
    <span className="ux-art-evidence">{video ? '움직임 예시' : '구도 예시'}</span>
  </div>;
}

