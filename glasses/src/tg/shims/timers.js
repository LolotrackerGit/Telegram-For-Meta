// Sostituisce node:timers/promises, rispettando l'opzione signal.
function wait(ms, value, options = {}) {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = globalThis.setTimeout(() => resolve(value), ms);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export { wait as setTimeout };

export default { setTimeout: wait };
