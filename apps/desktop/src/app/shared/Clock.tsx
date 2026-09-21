import { formatTime } from './format';

export function Clock({ stamp }: { stamp: number }) { return <time dateTime={new Date(stamp).toISOString()} title={new Date(stamp).toLocaleString('ko-KR')}>{formatTime(stamp)}</time>; }
