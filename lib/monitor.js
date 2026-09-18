// Coalesce snapshots: never queue every token or allow evaluations to overlap.
export function createMonitor({ evaluate, emit, interval = 900 }) {
  let latest = '', attempted = '', inFlight = null, finishing = false, sequence = 0;
  async function run(complete) {
    const response = latest;
    if (!response) return;
    attempted = response;
    const seq = ++sequence;
    const start = performance.now();
    emit('evaluation-start', { sequence: seq, chars: response.length, complete });
    try {
      const result = await evaluate(response, complete);
      emit('evaluation', { ...result, sequence: seq, chars: response.length, complete, latency: Math.round(performance.now() - start) });
    } catch (error) {
      emit('evaluation-error', { sequence: seq, chars: response.length, complete, message: error.message });
    }
  }
  const tick = () => {
    if (finishing || inFlight || !latest || latest === attempted) return;
    inFlight = run(false).finally(() => { inFlight = null; });
  };
  const timer = setInterval(tick, interval);
  return {
    update(text) { latest = text; },
    async finish(complete = true) {
      finishing = true;
      clearInterval(timer);
      await inFlight;
      // Final assessment carries complete=true even if text matches the prior snapshot.
      await run(complete);
    },
    cancel() { finishing = true; clearInterval(timer); },
  };
}
