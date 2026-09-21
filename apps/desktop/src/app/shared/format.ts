export function shortPath(path: string) { return path.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ') || '프로젝트 경로 없음'; }
export function formatTime(stamp: number) { return new Date(stamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }
