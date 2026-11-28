export const MAX_LAUNCH_URI: number;
export type PresentationPreferences = { format?: 'recommend' | 'html' | 'figma' | 'pptx'; design?: string; reference?: boolean };
export function presentationRequest(options?: PresentationPreferences): string[];
export function petStartRequest(input: { name: string; petId: string; petRevision: number; recipe?: string | null; task?: string;
  audience?: string; message?: string; newTask?: boolean; figma?: boolean; presentation?: PresentationPreferences; via?: 'skill' | 'tool' }): string;
export function codexLinkLength(prompt: string): number;
export function fitsCodexLink(prompt: string): boolean;
