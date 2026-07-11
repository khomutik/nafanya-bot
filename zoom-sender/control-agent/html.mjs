export function buildControlHtml() {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Нафаня в Zoom</title>
<style>
:root{font-family:Arial,sans-serif;color:#111a40;background:#111a40}*{box-sizing:border-box}body{margin:0}.control{background:#fbf7ea;padding:16px 20px;border-bottom:1px solid #cdc8bb}.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.title{font-size:22px;font-weight:800;margin-right:auto}.status{font-weight:700}.dot{font-size:24px}button,.auth-link{min-height:44px;border:1px solid #9c978c;background:#fffaf0;color:#111a40;padding:0 16px;font-size:16px;font-weight:700;cursor:pointer;border-radius:6px}.auth-link{display:inline-flex;align-items:center;text-decoration:none;background:#fff;color:#146b43;border-color:#146b43}button.primary{background:#146b43;color:white;border-color:#146b43}button.danger{background:#9e2d2d;color:white;border-color:#9e2d2d}button:disabled{opacity:.45;cursor:not-allowed}.message{margin-top:10px;color:#4f5365;min-height:20px}.auth-help{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:10px;border-left:4px solid #b27a13;background:#fff8df}.auth-warning{font-size:14px;color:#4f5365}iframe{display:block;width:100%;height:calc(100vh - 118px);border:0;background:#111a40}@media(max-width:640px){.title{width:100%;font-size:19px}.control{padding:12px}.row{gap:8px}button,.auth-link{flex:1;font-size:14px;padding:0 10px}iframe{height:calc(100vh - 180px)}}
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
    <button id="auth" title="Только если Zoom просит вход">Починить вход Zoom</button>
  </div>
  <div class="message" id="message"></div>
  <div class="auth-help" id="authHelp" hidden>
    <strong>Нужна ручная проверка Zoom.</strong>
    <a class="auth-link" id="authView" href="./vnc/vnc.html?autoconnect=true&amp;resize=scale&amp;path=nafanya-zoom-control/vnc/websockify" target="_blank" rel="noopener">Открыть окно Zoom для входа</a>
    <button class="danger" id="authStop">Остановить восстановление входа</button>
    <span class="auth-warning">Пароль, коды и cookies не отправляйте в чат и не сохраняйте.</span>
  </div>
</section>
<iframe src="./worker-panel" title="Zoom-only panel"></iframe>
<script>
const labels={off:["#a92f2f","Выключен"],starting:["#b27a13","Запускается"],stopping:["#b27a13","Выключается"],ready:["#167347","В Zoom, чат открыт"],auth_required:["#b45b16","Нужен вход в Zoom"],auth_setup_idle:["#a92f2f","Выключен"],auth_setup_starting:["#b27a13","Открывается окно входа"],auth_setup_waiting_for_manual_action:["#b45b16","Нужна ручная проверка"],auth_setup_completed:["#167347","Вход сохранён. Включите Нафаню"],auth_setup_failed:["#a92f2f","Ошибка входа"],error:["#a92f2f","Ошибка"]};
const $=id=>document.getElementById(id);let busy=false;
async function status(){try{const r=await fetch("./api/status",{cache:"no-store"});const s=await r.json();const v=labels[s.mode]||labels.error;$("dot").style.color=v[0];$("status").textContent=v[1];$("message").textContent=s.lastError||"";$("start").disabled=busy||s.running||s.mode==="starting"||s.authViewAvailable;$("stop").disabled=busy||!s.running;$("auth").hidden=s.mode!=="auth_required"&&s.mode!=="auth_setup_failed";$("authHelp").hidden=!s.authViewAvailable;}catch{$("status").textContent="Нет связи с управлением";$("dot").style.color=labels.error[0];}}
async function action(name){busy=true;await status();try{const r=await fetch("./api/"+name,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});const data=await r.json();if(!r.ok)$("message").textContent=data.error||"Операция не выполнена";}finally{busy=false;await status();}}
$("start").onclick=()=>action("start");$("stop").onclick=()=>action("stop");$("auth").onclick=()=>action("auth-setup");$("authStop").onclick=()=>action("auth-setup/stop");$("refresh").onclick=status;status();setInterval(status,3000);
</script>
</body></html>`;
}
