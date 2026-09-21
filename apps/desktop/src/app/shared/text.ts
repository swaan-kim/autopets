export const splitLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
