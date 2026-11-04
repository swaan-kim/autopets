import roles from '../../../../../packages/contracts/data/roles.json';
import type { PetCatalogEntry } from './petCatalog';
import type { PetRoleTemplate } from '@autopets/contracts/types';

export type PromptIdea = { id: string; kind: 'image' | 'video'; title: string; summary: string; art: string; prompt: string; conditions: string[] };
export const promptIdeas: PromptIdea[] = [
  { id: 'product', kind: 'image', title: '작은 브랜드의 제품 사진', summary: '부드러운 자연광과 넉넉한 여백', art: 'product', prompt: '[제품명] 하나를 크림색 배경에 배치해줘. 왼쪽 창에서 들어오는 부드러운 자연광, 짧은 그림자, 읽기 쉬운 라벨과 넉넉한 여백을 담아줘.', conditions: ['3:2 가로 구도', '자연광', '제품 사진'] },
  { id: 'coast', kind: 'video', title: '호수 위의 느린 오후', summary: '백조의 움직임과 물 위에 번지는 잔물결', art: 'swans', prompt: '늦은 오후의 잔잔한 호수. 백조들이 천천히 헤엄치며 물 위로 잔물결을 남긴다. 따뜻한 노을빛과 호수의 반사를 담아 고요한 한 장면으로 만들어줘.', conditions: ['가로 화면', '느린 움직임', '호수 풍경'] },
  { id: 'poster', kind: 'image', title: '시선이 머무는 포스터', summary: '큰 제목과 따뜻한 종이의 질감', art: 'poster', prompt: '[행사명]을 위한 미니멀 포스터. 아이보리 종이, 짙은 녹색의 큰 제목, 작은 일정 정보와 충분한 여백. 행사명·날짜·장소를 확인하고 정확하게 배치해줘.', conditions: ['세로 포스터', '타이포그래피', '행사 홍보'] },
  { id: 'orbit', kind: 'video', title: '네온빛이 번지는 밤', summary: '젖은 거리와 우산을 쓴 인물의 걸음', art: 'rain', prompt: '비 오는 네온 거리에서 후드를 입은 인물이 우산을 들고 앞으로 걷는다. 젖은 바닥에 분홍색과 청록색 조명이 비치고, 걸음과 빗방울이 자연스럽게 이어지는 짧은 장면으로 만들어줘.', conditions: ['가로 화면', '걷는 인물', '비와 네온'] },
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
  entry.template.instruction += `\n사용자가 선택한 기본 방향: ${idea.prompt} 기본 조건: ${idea.conditions.join(' · ')}. 대괄호의 정보는 현재 요청에서 확인하세요.`;
  entry.example = idea.prompt;
  return entry;
}
