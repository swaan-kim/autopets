export type ModelInformationResult =
  | { status: 'unknown'; model: string }
  | { status: 'reference' | 'stale'; model: string; surfaces: string[]; axis: string; summary: string;
      sourceUrl: string; sourceTitle: string; publishedAt: string; reviewedAt: string; conditions: string };
export function modelInformation(model: string, surface?: string, now?: number): ModelInformationResult;
