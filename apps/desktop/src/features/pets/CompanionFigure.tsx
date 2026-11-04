import { useId } from 'react';

// One articulated character. Poses change its joints, never replace a frame.
export function CompanionFigure() {
  const id = 'pup' + useId().replace(/:/g, '');
  const paint = (name: string) => 'url(#' + id + name + ')';
  return <svg className="companion-figure" viewBox="0 0 320 320" aria-hidden="true">
    <defs>
      <radialGradient id={id + 'fur'} cx=".35" cy=".22" r=".8"><stop stopColor="#fff6df" /><stop offset=".58" stopColor="#f3dfbd" /><stop offset="1" stopColor="#ccaa83" /></radialGradient>
      <radialGradient id={id + 'face'} cx=".36" cy=".28" r=".76"><stop stopColor="#fff7e2" /><stop offset=".67" stopColor="#f4e1c0" /><stop offset="1" stopColor="#d4b48c" /></radialGradient>
      <radialGradient id={id + 'ear'} cx=".36" cy=".3" r=".8"><stop stopColor="#edd1a7" /><stop offset=".6" stopColor="#d6b185" /><stop offset="1" stopColor="#b58d66" /></radialGradient>
      <radialGradient id={id + 'muzzle'} cx=".45" cy=".25" r=".8"><stop stopColor="#fff4dc" /><stop offset="1" stopColor="#eed8b5" /></radialGradient>
      <radialGradient id={id + 'eye'} cx=".3" cy=".2" r=".8"><stop stopColor="#42443f" /><stop offset=".45" stopColor="#191d1b" /><stop offset="1" stopColor="#080d0b" /></radialGradient>
      <linearGradient id={id + 'tongue'} x2="0" y2="1"><stop stopColor="#c77770" /><stop offset="1" stopColor="#f4b4a1" /></linearGradient>
    </defs>
    <ellipse className="rig-shadow" cx="160" cy="294" rx="72" ry="9" fill="#736749" opacity=".15" />
    <g className="rig-jump">
      <g className="rig-breathe">
        <g className="rig-tail">
          <path d="M216 260c17 0 29-7 34-20 6-14-1-24-10-20-6 3-3 12-9 15-4 3-10 1-16 4z" fill={paint('ear')} />
          <path d="M234 235c8-4 9-8 8-11" fill="none" stroke="#f7dfba" strokeWidth="5" strokeLinecap="round" opacity=".6" />
        </g>
        <path d="M126 183c-23 11-31 38-30 64 1 28 21 42 64 42s63-14 64-42c1-26-7-53-30-64z" fill={paint('fur')} />
        <ellipse cx="160" cy="244" rx="31" ry="39" fill="#fff2d9" opacity=".6" />
        <ellipse cx="119" cy="281" rx="27" ry="16" fill={paint('fur')} />
        <ellipse cx="201" cy="281" rx="27" ry="16" fill={paint('fur')} />
        <path d="M108 286v5m11-5v6m71-6v5m11-5v6" stroke="#bc9874" strokeWidth="2" strokeLinecap="round" opacity=".45" />
        <g className="rig-arm-pose rig-arm-left"><g className="rig-paw-tap rig-paw-left">
          <path d="M117 209c-11-3-20 7-22 24l-3 28c-1 14 13 21 25 16 11-5 10-15 11-27l1-22c0-11-4-17-12-19z" fill={paint('fur')} />
          <g className="rig-paw-pads"><ellipse cx="108" cy="260" rx="9" ry="7" fill="#dca38d" /><circle cx="99" cy="249" r="3" fill="#e8b29d" /><circle cx="108" cy="246" r="3" fill="#e8b29d" /><circle cx="117" cy="249" r="3" fill="#e8b29d" /></g>
        </g></g>
        <g className="rig-arm-pose rig-arm-right"><g className="rig-paw-tap rig-paw-right">
          <path d="M203 209c11-3 20 7 22 24l3 28c1 14-13 21-25 16-11-5-10-15-11-27l-1-22c0-11 4-17 12-19z" fill={paint('fur')} />
          <g className="rig-paw-pads"><ellipse cx="212" cy="260" rx="9" ry="7" fill="#dca38d" /><circle cx="203" cy="249" r="3" fill="#e8b29d" /><circle cx="212" cy="246" r="3" fill="#e8b29d" /><circle cx="221" cy="249" r="3" fill="#e8b29d" /></g>
        </g></g>
        <g className="rig-head-pose"><g className="rig-head-look">
          <g className="rig-ear-left"><path d="M102 72c-25-10-43 13-53 38-9 21-13 43 3 51 16 9 34-4 41-23l20-44z" fill={paint('ear')} /><path d="M83 91c-12 5-21 21-25 38" fill="none" stroke="#f6ddba" strokeWidth="7" strokeLinecap="round" opacity=".45" /></g>
          <g className="rig-ear-right"><path d="M218 72c25-10 43 13 53 38 9 21 13 43-3 51-16 9-34-4-41-23l-20-44z" fill={paint('ear')} /><path d="M237 91c12 5 21 21 25 38" fill="none" stroke="#f6ddba" strokeWidth="7" strokeLinecap="round" opacity=".35" /></g>
          <path d="M160 46c45 0 75 30 78 77 4 45-18 81-78 81s-82-36-78-81c3-47 33-77 78-77z" fill={paint('face')} />
          <path d="M142 49c-5-11 3-18 12-13 1-13 13-13 17-3 10-4 17 7 10 15" fill={paint('face')} />
          <ellipse cx="160" cy="170" rx="36" ry="22" fill={paint('muzzle')} />
          <g className="rig-gaze">
            <g className="rig-eye rig-eye-left"><ellipse cx="128" cy="137" rx="10" ry="14" fill={paint('eye')} /><ellipse cx="125" cy="132" rx="3.2" ry="4" fill="#fffdf7" /><circle cx="132" cy="143" r="1.4" fill="#a3b2a6" opacity=".7" /></g>
            <g className="rig-eye rig-eye-right"><ellipse cx="192" cy="137" rx="10" ry="14" fill={paint('eye')} /><ellipse cx="189" cy="132" rx="3.2" ry="4" fill="#fffdf7" /><circle cx="196" cy="143" r="1.4" fill="#a3b2a6" opacity=".7" /></g>
          </g>
          <path className="rig-brows" d="M119 116q9-5 16-1m50 0q8-4 16 1" fill="none" stroke="#a58160" strokeWidth="3" strokeLinecap="round" opacity=".4" />
          <ellipse cx="160" cy="160" rx="9" ry="6.5" fill={paint('eye')} /><ellipse cx="157" cy="158" rx="3.5" ry="1.5" fill="#777a6d" opacity=".6" />
          <path d="M160 166v6m0 0c-2 7-12 8-16 2m16-2c2 7 12 8 16 2" fill="none" stroke="#3b352c" strokeWidth="3" strokeLinecap="round" />
          <g className="rig-smile"><path d="M146 175q14 7 28 0c0 20-28 20-28 0" fill="#65463b" /><path d="M151 182q9-6 18 0c-1 12-17 12-18 0" fill={paint('tongue')} /></g>
          <ellipse cx="109" cy="162" rx="9" ry="4" fill="#e6af91" opacity=".22" /><ellipse cx="211" cy="162" rx="9" ry="4" fill="#e6af91" opacity=".22" />
        </g></g>
      </g>
    </g>
  </svg>;
}
