export type AssistanceAction = (name: string, args: Record<string, unknown>, message: string) => Promise<boolean>;
