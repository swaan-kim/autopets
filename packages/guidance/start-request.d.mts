export const MAX_LAUNCH_URI: number;
export function petStartRequest(input: { name: string; petId: string; petRevision: number; recipe?: string | null; task?: string;
  audience?: string; message?: string; newTask?: boolean; figma?: boolean }): string;
export function codexLinkLength(prompt: string): number;
export function fitsCodexLink(prompt: string): boolean;
