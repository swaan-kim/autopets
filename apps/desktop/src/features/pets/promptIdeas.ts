import roles from '../../../../../packages/contracts/data/roles.json';
import type { PetCatalogEntry } from './petCatalog';
import type { PetRoleTemplate } from '@autopets/contracts/types';

export type PromptIdea = { id: string; kind: 'image' | 'video'; title: string; summary: string; art: string; prompt: string; conditions: string[] };
export const promptIdeas: PromptIdea[] = [
  { id: 'product', kind: 'image', title: '작은 브랜드의 제품 사진', summary: '부드러운 자연광과 넉넉한 여백', art: 'product', prompt: '[제품명] 하나를 크림색 배경에 배치해줘. 왼쪽 창에서 들어오는 부드러운 자연광, 짧은 그림자, 읽기 쉬운 라벨과 넉넉한 여백을 담아줘.', conditions: ['정사각형', '자연광', '제품 사진'] },
  { id: 'coast', kind: 'video', title: '느긋한 해변의 한 장면', summary: '잔잔한 파도와 천천히 움직이는 카메라', art: 'coast', prompt: '해 질 무렵 고요한 해변. 잔잔한 파도가 모래 위로 밀려오고 카메라가 천천히 앞으로 이동한다. 따뜻한 빛과 일정한 속도를 유지하는 한 장면.', conditions: ['가로 화면', '느린 전진', '한 장면'] },
  { id: 'poster', kind: 'image', title: '시선이 머무는 포스터', summary: '큰 제목과 따뜻한 종이의 질감', art: 'poster', prompt: '[행사명]을 위한 미니멀 포스터. 아이보리 종이, 짙은 녹색의 큰 제목, 작은 일정 정보와 충분한 여백. 행사명·날짜·장소를 확인하고 정확하게 배치해줘.', conditions: ['세로 화면', '타이포그래피', '행사 홍보'] },
  { id: 'orbit', kind: 'video', title: '제품을 천천히 둘러보기', summary: '제품의 형태를 유지하는 작은 회전', art: 'orbit', prompt: '[제품명]이 밝은 스튜디오 받침대에 놓여 있다. 카메라가 제품을 중심으로 천천히 작은 각도로 이동한다. 형태와 라벨을 유지하고 조명은 일정하게.', conditions: ['정사각형', '작은 회전', '제품 영상'] },
];

const base = roles.find(role => role.id === 'research-document') as PetRoleTemplate;
export const promptPets: PetCatalogEntry[] = (['image', 'video'] as const).map(kind => ({
  id: `${kind}-prompt`, category: 'work', name: kind === 'image' ? '이미지 프롬프트 만들기' : '영상 프롬프트 만들기',
  summary: '원하는 구도와 분위기를 생성 도구에 쓸 요청으로 정리해요.', inputLabel: '만들고 싶은 장면', optionalLabel: '구도와 분위기',
  example: promptIdeas.find(idea => idea.kind === kind)!.prompt, output: '생성 도구에 쓸 프롬프트와 입력 조건',
  before: '어떤 장면을 어떻게 설명할지 막막해요.', after: '장면·구도·빛·움직임을 짧은 프롬프트로 정리해요.',
  limit: '이 펫은 프롬프트를 정리해요. 이미지·영상 생성 도구 연결과 실제 결과는 따로 확인해요.',
  symbol: kind === 'image' ? '▧' : '▷', publisher: 'AutoPets', source: null,
  template: { ...structuredClone(base), name: kind === 'image' ? '이미지 프롬프트 펫' : '영상 프롬프트 펫', planFirst: false,
    planning: { model: 'gpt-6-luna', reasoning: 'low' }, execution: { model: 'gpt-6-luna', reasoning: 'low' },
    instruction: `사용자가 원하는 ${kind === 'image' ? '이미지' : '영상'}의 장면과 구도를 생성 도구에 쓸 프롬프트로 정리하세요. 주인공·배경·빛${kind === 'video' ? '·카메라 움직임' : '·구도'}을 구체적으로 쓰세요. 실제 생성하지 않았다면 생성 완료나 결과 보장을 주장하지 마세요. 도구별 입력 조건은 확인한 것만 안내하세요. 사용자의 현재 요청을 저장한 예시보다 우선하세요.`,
  },
}));

export function petForPromptIdea(idea: PromptIdea): PetCatalogEntry {
  const entry = structuredClone(promptPets.find(item => item.id === `${idea.kind}-prompt`)!);
  entry.template.instruction += `\n사용자가 선택한 기본 방향: ${idea.prompt} 대괄호의 정보는 현재 요청에서 확인하세요.`;
  entry.example = idea.prompt;
  return entry;
}
