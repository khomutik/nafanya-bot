export function buildControlHtml() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Нафаня в Zoom</title>
<style>
:root{font-family:Arial,sans-serif;color:#111a40;background:#111a40}*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;flex-direction:column;overflow:hidden}.control{position:sticky;top:0;z-index:10;background:#fbf7ea;padding:7px 10px;border-bottom:1px solid #cdc8bb;box-shadow:0 1px 6px rgba(17,26,64,.12)}.row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.title{font-size:16px;font-weight:850;margin-right:auto}.status{font-size:13px;font-weight:750;white-space:nowrap}.dot{font-size:16px}button,.auth-link{min-height:32px;border:1px solid #9c978c;background:#fffaf0;color:#111a40;padding:0 10px;font-size:13px;font-weight:800;cursor:pointer;border-radius:6px}.auth-link{display:inline-flex;align-items:center;text-decoration:none;background:#fff;color:#146b43;border-color:#146b43}button.primary{background:#146b43;color:white;border-color:#146b43}button.danger{background:#9e2d2d;color:white;border-color:#9e2d2d}button:disabled{opacity:.45;cursor:not-allowed}.message{color:#4f5365;min-height:16px;font-size:12px;line-height:1.3;flex-basis:100%}.admin-panel{margin-top:5px;border:1px solid #d8d0c1;border-radius:7px;background:#fffaf0;padding:5px 7px}.admin-panel>summary{cursor:pointer;font-size:12px;font-weight:850;color:#4f5365}.auth-help{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:6px;padding:7px;border-left:4px solid #b27a13;background:#fff8df}.auth-help[hidden]{display:none}.auth-warning{font-size:12px;color:#4f5365}iframe{display:block;width:100%;flex:1 1 auto;min-height:0;border:0;background:#111a40}@media(max-width:640px){.control{padding:6px}.row{gap:5px}.title{width:100%;font-size:15px}.status{margin-right:auto}button,.auth-link{font-size:12px;padding:0 8px;min-height:34px}.message{font-size:12px}}
</style>
</head>
<body>
<section class="control">
  <div class="row">
    <div class="title">Нафаня в Zoom</div>
    <div class="status"><span class="dot" id="dot">●</span> <span id="status">Проверяю…</span></div>
    <button class="primary" id="start">Включить Нафаню</button>
    <button class="danger" id="stop">Выключить Нафаню</button>
    <button id="refresh" title="Обновить статус">Обновить</button>
    <div class="message" id="message"></div>
  </div>
  <details class="admin-panel" id="adminPanel">
    <summary>Админ / вход Zoom</summary>
    <button id="auth" title="Только если Zoom просит вход">Починить вход Zoom</button>
    <div class="auth-help" id="authHelp" hidden>
      <strong>Нужна ручная проверка Zoom.</strong>
      <a class="auth-link" id="authView" href="./vnc/vnc.html?autoconnect=true&amp;resize=scale&amp;path=nafanya-zoom-control/vnc/websockify" target="_blank" rel="noopener">Открыть окно Zoom для входа</a>
      <button class="danger" id="authStop">Остановить восстановление входа</button>
      <span class="auth-warning">Пароль, коды и cookies не отправляйте в чат и не сохраняйте.</span>
    </div>
  </details>
</section>
<iframe id="workerPanel" src="./worker-panel" title="Zoom-only panel"></iframe>
<script>
const labels={off:["#a92f2f","Выключен"],starting:["#b27a13","Запускается"],stopping:["#b27a13","Выключается"],ready:["#167347","В Zoom, чат открыт"],auth_required:["#b45b16","Нужен вход в Zoom"],auth_setup_idle:["#a92f2f","Выключен"],auth_setup_starting:["#b27a13","Открывается окно входа"],auth_setup_waiting_for_manual_action:["#b45b16","Нужна ручная проверка"],auth_setup_completed:["#167347","Вход сохранён. Включите Нафаню"],auth_setup_failed:["#a92f2f","Ошибка входа"],error:["#a92f2f","Ошибка"]};
const $=id=>document.getElementById(id);let busy=false;let pendingMessage="";
function syncAdminVisibility(s){const admin=$("adminPanel");const needAuth=s?.mode==="auth_required"||s?.mode==="auth_setup_failed";if(needAuth)admin.open=true;$("auth").hidden=!needAuth&&!admin.open;$("authHelp").hidden=!s?.authViewAvailable;}
async function status(){try{const r=await fetch("./api/status",{cache:"no-store"});const s=await r.json();const v=labels[s.mode]||labels.error;$("dot").style.color=v[0];$("status").textContent=v[1];const next=s.mode==="error"?"Нажмите Обновить или Выключить Нафаню.":s.mode==="auth_required"?"Нажмите Починить вход Zoom.":"";$("message").textContent=[s.lastError,pendingMessage,next].filter(Boolean).join(" ");$("start").disabled=busy||s.running||s.mode==="starting"||s.authViewAvailable;$("stop").disabled=busy||!s.running;syncAdminVisibility(s);return s;}catch{$("status").textContent="Нет связи с управлением";$("dot").style.color=labels.error[0];return null;}}
async function refreshAll(){pendingMessage="";await status();const panel=$("workerPanel");panel.src="./worker-panel?refresh="+Date.now();}
async function action(name){busy=true;pendingMessage="";await status();try{const r=await fetch("./api/"+name,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});const data=await r.json();if(!r.ok)pendingMessage=data.error||"Операция не выполнена";}finally{busy=false;await status();}}
$("start").onclick=()=>action("start");$("stop").onclick=()=>action("stop");$("auth").onclick=()=>action("auth-setup");$("authStop").onclick=()=>action("auth-setup/stop");$("refresh").onclick=refreshAll;status();setInterval(status,3000);
$("adminPanel").addEventListener("toggle",()=>status());
</script>
</body></html>`;
}
