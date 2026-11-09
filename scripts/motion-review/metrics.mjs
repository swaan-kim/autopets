// Pure summaries of the per-frame samples. Thresholds are deliberately absent:
// they are set after the first baseline measurement, not assumed here.
export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}
const round = value => value === null ? null : Math.round(value * 10) / 10;

export function frameTiming(frames) {
  const intervals = [];
  for (let index = 1; index < frames.length; index++) intervals.push(frames[index].t - frames[index - 1].t);
  return {
    frames: frames.length,
    p50: round(quantile(intervals, 0.5)), p95: round(quantile(intervals, 0.95)), max: round(intervals.length ? Math.max(...intervals) : null),
    // At a 60Hz reference, >34ms means at least one missed frame.
    over34: intervals.filter(value => value > 34).length,
    over50: intervals.filter(value => value > 50).length,
    over100: intervals.filter(value => value > 100).length,
  };
}

// A sprite cell swap with no visible blend layer is a hard pose jump.
export function poseContinuity(frames) {
  let swaps = 0, hard = 0, maxShift = 0, maxResize = 0;
  for (let index = 1; index < frames.length; index++) {
    const before = frames[index - 1], after = frames[index];
    if (before.bg && after.bg && before.bg !== after.bg) {
      swaps++;
      const next = frames[index + 1];
      if (after.blend <= 0.01 && (!next || next.blend <= 0.01)) hard++;
    }
    if (before.box && after.box && before.box[3] > 0) {
      const [x0, y0, w0, h0] = before.box, [x1, y1, w1, h1] = after.box;
      const shift = Math.hypot(x1 + w1 / 2 - (x0 + w0 / 2), y1 + h1 / 2 - (y0 + h0 / 2)) / h0;
      maxShift = Math.max(maxShift, shift);
      maxResize = Math.max(maxResize, Math.abs(h1 - h0) / h0);
    }
  }
  // Paw travel per frame relative to the pet height: the visible "jump" of the art.
  let pawMax = 0, pawJumps = 0;
  for (let index = 1; index < frames.length; index++) {
    const before = frames[index - 1], after = frames[index];
    if (!before.paw || !after.paw || !after.box?.[3]) continue;
    const travel = Math.hypot(after.paw[0] - before.paw[0], after.paw[1] - before.paw[1]) / after.box[3];
    pawMax = Math.max(pawMax, travel);
    if (travel > 0.02) pawJumps++;
  }
  const seconds = frames.length > 1 ? (frames.at(-1).t - frames[0].t) / 1000 : 0;
  return {
    pawJumpMax: Math.round(pawMax * 1000) / 1000, pawJumpsPerSecond: seconds ? Math.round(pawJumps / seconds * 100) / 100 : 0,
    swaps, hardSwaps: hard, hardSwapsPerSecond: seconds ? Math.round(hard / seconds * 100) / 100 : 0,
    // Relative to the pet height per frame; large values read as a pop.
    maxShiftPerFrame: Math.round(maxShift * 1000) / 1000, maxResizePerFrame: Math.round(maxResize * 1000) / 1000,
  };
}

export function behaviour(frames) {
  let cardOpens = 0, completions = 0, greetWhileWorking = false, playing = 0;
  const clips = [];
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index], previous = frames[index - 1];
    if (frame.card && previous && !previous.card) cardOpens++;
    if (frame.clip === 'complete' && previous?.clip !== 'complete') completions++;
    if (frame.clip === 'greet' && (frame.state === 'working' || frame.state === 'planning')) greetWhileWorking = true;
    if (frame.playing) playing++;
    if (frame.clip && clips.at(-1) !== frame.clip) clips.push(frame.clip);
  }
  if (frames[0]?.card) cardOpens++;
  const leans = frames.map(frame => Math.abs(frame.lean ?? 0));
  return {
    cardOpens, completions, greetWhileWorking, clips, playingRatio: frames.length ? playing / frames.length : 0, lastState: frames.at(-1)?.state ?? null, cardAtEnd: Boolean(frames.at(-1)?.card),
    // Whole-body lean in degrees: how visibly the body follows a drag and whether it settles.
    leanMax: leans.length ? Math.round(Math.max(...leans) * 10) / 10 : 0, leanEnd: Math.round((leans.at(-1) ?? 0) * 10) / 10,
  };
}

export function summarize(frames) {
  return { timing: frameTiming(frames), pose: poseContinuity(frames), ...behaviour(frames) };
}
