async function callDurableObject(stub, path, payload, fallbackError) {
  const response = await stub.fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || fallbackError);
  }
  return data;
}

export async function callQueueState(env, action, payload = {}) {
  const stub = env.QUEUE_STATE.getByName("main");
  return callDurableObject(stub, `https://queue/${action}`, payload, "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0447\u0435\u0440\u0435\u0434\u0438.");
}

export async function callTimerState(env, action, payload = {}) {
  const stub = env.TIMER_STATE.getByName("main");
  return callDurableObject(stub, `https://timer/${action}`, payload, "\u041e\u0448\u0438\u0431\u043a\u0430 \u0442\u0430\u0439\u043c\u0435\u0440\u0430.");
}

export async function callLightTalkState(env, action, payload = {}, key) {
  const stub = env.LIGHT_TALK_STATE.getByName(key);
  return callDurableObject(stub, `https://light-talk/${action}`, payload, "\u041e\u0448\u0438\u0431\u043a\u0430 \u043b\u0451\u0433\u043a\u043e\u0439 \u0431\u0435\u0441\u0435\u0434\u044b.");
}

export async function callAnnouncementState(env, action, payload = {}) {
  const stub = env.ANNOUNCEMENT_STATE.getByName("main");
  return callDurableObject(stub, `https://announcement/${action}`, payload, "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u044a\u044f\u0432\u043b\u0435\u043d\u0438\u0439.");
}

export async function callPersonalDayState(env, action, payload = {}) {
  const stub = env.ANNOUNCEMENT_STATE.getByName("main");
  return callDurableObject(stub, `https://announcement/${action}`, payload, "\u041e\u0448\u0438\u0431\u043a\u0430 \u043b\u0438\u0447\u043d\u043e\u0439 \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0438.");
}
