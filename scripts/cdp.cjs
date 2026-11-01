// Attach to a user-authorized debugging browser. Never closes that browser.
async function connect(port = 9222) {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const waiting = new Map();
  const handlers = new Map();
  socket.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data);
    if (result.method) {
      for (const handler of handlers.get(result.method) || []) handler(result.params, result.sessionId);
      return;
    }
    const pending = waiting.get(result.id);
    if (!pending) return;
    waiting.delete(result.id); clearTimeout(pending.timer);
    if (result.error) pending.reject(new Error(result.error.message));
    else pending.resolve(result.result);
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      waiting.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async function attach(targetId) { return (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId; }
  async function evaluate(sessionId, expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  function on(method, handler) {
    if (!handlers.has(method)) handlers.set(method, new Set());
    handlers.get(method).add(handler);
    return () => handlers.get(method)?.delete(handler);
  }
  return { send, attach, evaluate, on, close() { socket.close(); for (const pending of waiting.values()) clearTimeout(pending.timer); waiting.clear(); handlers.clear(); } };
}
module.exports = { connect };
