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
    const error = new Error(data.error || fallbackError);
    error.reason = String(data.reason || data.code || "").trim();
    error.status = response.status;
    throw error;
  }
  return data;
}

async function callMigratedZoomState(env, {
  bindingName,
  baseUrl,
  action,
  payload,
  fallbackError,
  legacyExportAction,
  instanceName = "main",
  migrateLegacy = true
}) {
  const namespace = env?.[bindingName];
  if (!namespace?.getByName) {
    throw new Error(`Durable Object binding ${bindingName} is not configured.`);
  }
  const stub = namespace.getByName(instanceName);
  const call = () => callDurableObject(stub, `${baseUrl}/${action}`, payload, fallbackError);
  try {
    return await call();
  } catch (error) {
    if (error?.reason !== "not_initialized") throw error;
  }

  const legacy = migrateLegacy
    ? await callAnnouncementState(env, legacyExportAction)
    : { state: {} };
  await callDurableObject(
    stub,
    `${baseUrl}/initialize_from_legacy`,
    { state: legacy.state || {} },
    fallbackError
  );
  return call();
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

export async function callZoomMeetingState(env, action, payload = {}, options = {}) {
  return callMigratedZoomState(env, {
    bindingName: "ZOOM_MEETING_STATE",
    baseUrl: "https://zoom-meeting",
    action,
    payload,
    fallbackError: "\u041e\u0448\u0438\u0431\u043a\u0430 Zoom-\u043f\u0443\u043b\u044c\u0442\u0430.",
    legacyExportAction: "export_zoom_meeting_state",
    instanceName: String(options.instanceName || "main"),
    migrateLegacy: options.migrateLegacy !== false
  });
}

export async function callZoomSharedTimerState(env, action, payload = {}) {
  return callMigratedZoomState(env, {
    bindingName: "ZOOM_SHARED_TIMER_STATE",
    baseUrl: "https://zoom-shared-timer",
    action,
    payload,
    fallbackError: "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u0449\u0435\u0433\u043e Zoom-\u0442\u0430\u0439\u043c\u0435\u0440\u0430.",
    legacyExportAction: "export_zoom_shared_timer_state"
  });
}

export async function callScheduleState(env, action, payload = {}) {
  const stub = env.ANNOUNCEMENT_STATE.getByName("schedule");
  return callDurableObject(stub, `https://announcement/${action}`, payload, "\u041e\u0448\u0438\u0431\u043a\u0430 cron-\u043e\u0442\u043c\u0435\u0442\u043e\u043a.");
}

export async function callPersonalDayState(env, action, payload = {}) {
  const stub = env.ANNOUNCEMENT_STATE.getByName("main");
  return callDurableObject(stub, `https://announcement/${action}`, payload, "\u041e\u0448\u0438\u0431\u043a\u0430 \u043b\u0438\u0447\u043d\u043e\u0439 \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0438.");
}
