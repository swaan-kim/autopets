export const MAX_LAUNCH_URI: number;
export const PPTX_REQUEST: string;
export const DESIGN_REFERENCE_REQUEST: string;
export function petStartRequest(input: { name: string; petId: string; petRevision: number; recipe?: string | null; task?: string;
  audience?: string; message?: string; newTask?: boolean; figma?: boolean; pptx?: boolean; designReference?: boolean; via?: 'skill' | 'tool' }): string;
export function codexLinkLength(prompt: string): number;
export function fitsCodexLink(prompt: string): boolean;
