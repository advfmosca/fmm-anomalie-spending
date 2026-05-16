// FMM Anomalie Spending — dashboard logic
const DATA_BASE = "data/";
const state = { index: null, current: null, charts: {}, selectedRowId: null };

function eur(n){ if(n==null||isNaN(n)) return "—"; const s = (Math.round(n*100)/100).toLocaleString("it-IT",{minimumFractionDigits:2,maximumFractionDigits:2}); return s+" €"; }
function pct(n){ if(n==null||isNaN(n)) return "n/a"; const sign = n>=0 ? "+" : ""; return sign + n.toLocaleString("it-IT",{minimumFractionDigits:1,maximumFractionDigits:1}) + "%"; }
function fmtDate(iso){ const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; }
function fmtDateTime(iso){ const d=new Date(iso); return d.toLocaleString("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
function platClass(p){ return p; }
function deltaClass(n){ if(n==null) return "delta-na"; return n>=0 ? "delta-pos" : "delta-neg"; }

async function loadJSON(path){
  const r = await fetch(path, {cache:"no-store"});
  if(!r.ok) throw new Error("fetch "+path+" "+r.status);
  return r.json();
}

function triggerLabel(triggers){
  const s = new Set(triggers);
  if(s.has(">50€") && s.has(">30%")) return {label:">50€ + >30%", cls:"both"};
  if(s.has(">50€")) return {label:">50€", cls:"spike50"};
  if(s.has(">30%")) return {label:">30%", cls:"spike30"};
  return {label:"—", cls:""};
}

function renderSidebar(){
  const el = document.getElementById("checks-list");
  if(!state.index || !state.index.checks.length){ el.innerHTML = '<div class="empty-state">Nessun check disponibile.</div>'; return; }
  el.innerHTML = state.index.checks.map(c=>{
    const tot = c.alerts_total;
    const stats = tot === 0
      ? '<span class="pill ok">OK</span>'
      : `<span class="pill zero">${c.zero}</span><span class="pill spike">${c.spike}</span>`;
    return `<div class="check-item${state.current && state.current.run_date===c.date?' active':''}" data-date="${c.date}">
      <div><div class="check-date">${fmtDate(c.date)}</div><div class="check-stats">${stats}</div></div>
    </div>`;
  }).join("");
  el.querySelectorAll(".check-item").forEach(it=>it.addEventListener("click", ()=>loadCheck(it.dataset.date)));
  document.getElementById("last-update").textContent = state.index.last_updated ? fmtDateTime(state.index.last_updated) : "—";
}

function destroyCharts(){ Object.values(state.charts).forEach(c=>c.destroy()); state.charts = {}; }

function renderChart(canvasId, accountId, accountName, platform){
  const trend = (state.current.trend_30d || {})[accountId];
  if(!trend || !trend.length){ return; }
  const labels = trend.map(p=>fmtDate(p.date));
  const data = trend.map(p=>+p.spend);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const platColor = platform==="Meta" ? "#1877f2" : platform==="Google" ? "#ea4335" : "#ff0050";
  const gradient = ctx.createLinearGradient(0,0,0,260);
  gradient.addColorStop(0, platColor + "55");
  gradient.addColorStop(1, platColor + "00");
  state.charts[canvasId] = new Chart(ctx, {
    type:"line",
    data:{ labels, datasets:[{ label:"Spend €", data, borderColor:platColor, backgroundColor:gradient, fill:true, tension:.3, pointRadius:2, pointHoverRadius:5, borderWidth:2 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx=>` ${eur(ctx.parsed.y)}` } } },
      scales:{
        x:{ ticks:{ color:"#8b95a7", maxRotation:0, autoSkip:true, maxTicksLimit:8 }, grid:{ color:"#262b36" } },
        y:{ ticks:{ color:"#8b95a7", callback:v=>eur(v) }, grid:{ color:"#262b36" }, beginAtZero:true }
      }
    }
  });
}

function renderAlerts(){
  const c = state.current;
  const cont = document.getElementById("content");
  destroyCharts();
  if(!c){ cont.innerHTML = '<div class="empty-state">Seleziona un check dalla colonna a sinistra.</div>'; return; }

  const ac = c.summary.accounts_checked || {};
  const totAcc = Object.values(ac).reduce((a,b)=>a+b,0);
  const zero = c.zero_alerts || [];
  const spikes = c.spike_alerts || [];

  let html = `
    <div class="cards">
      <div class="card"><div class="card-label">Data check</div><div class="card-value">${fmtDate(c.run_date)}</div><div class="card-sub">Eseguito ${fmtDateTime(c.executed_at)}</div></div>
      <div class="card"><div class="card-label">Account controllati</div><div class="card-value">${totAcc}</div><div class="card-sub">Meta ${ac.Meta||0} · Google ${ac.Google||0} · TikTok ${ac.TikTok||0}</div></div>
      <div class="card"><div class="card-label">Zero anomalo</div><div class="card-value accent-zero">${zero.length}</div><div class="card-sub">Account a 0 € con storico &gt; 0</div></div>
      <div class="card"><div class="card-label">Spike sopra soglia</div><div class="card-value accent-spike">${spikes.length}</div><div class="card-sub">&gt;50 €/giorno o +30% vs media 7gg</div></div>
    </div>`;

  if(zero.length === 0 && spikes.length === 0){
    html += `<div class="section"><div class="empty-state"><div class="big">✅</div><div>Nessuna anomalia rilevata in questo check.</div></div></div>`;
  }

  if(zero.length){
    html += `<div class="section"><h2>⚡ Spending ZERO anomalo <span class="badge">${zero.length} account</span></h2>
      <table class="alerts"><thead><tr><th>Piattaforma</th><th>Account</th><th class="num">Spend ieri</th><th class="num">Media 7gg</th><th>Causa inferita</th></tr></thead><tbody>`;
    zero.forEach((a,i)=>{
      const rowId = `z-${i}`;
      const critical = (a.cause||"").includes("Account sospeso");
      html += `<tr class="acc-row" data-rid="${rowId}" data-aid="${a.account_id}" data-name="${a.name}" data-plat="${a.platform}">
        <td><span class="plat ${platClass(a.platform)}">${a.platform}</span></td>
        <td><strong>${a.name}</strong></td>
        <td class="num">${eur(a.spend_yest)}</td>
        <td class="num">${eur(a.avg7)}</td>
        <td><span class="cause-tag ${critical?'crit':''}">${a.cause||"—"}</span></td>
      </tr>`;
    });
    html += `</tbody></table><div class="hint">Clicca su una riga per visualizzare il trend a 30 giorni.</div></div>`;
  }

  if(spikes.length){
    html += `<div class="section"><h2>🔥 Spending sopra soglia <span class="badge">${spikes.length} account</span></h2>
      <table class="alerts"><thead><tr><th>Piattaforma</th><th>Account</th><th class="num">Spend ieri</th><th class="num">Media 7gg</th><th class="num">Δ%</th><th>Trigger</th></tr></thead><tbody>`;
    spikes.forEach((a,i)=>{
      const rowId = `s-${i}`;
      const t = triggerLabel(a.triggers);
      html += `<tr class="acc-row" data-rid="${rowId}" data-aid="${a.account_id}" data-name="${a.name}" data-plat="${a.platform}">
        <td><span class="plat ${platClass(a.platform)}">${a.platform}</span></td>
        <td><strong>${a.name}</strong></td>
        <td class="num">${eur(a.spend_yest)}</td>
        <td class="num">${eur(a.avg7)}</td>
        <td class="num ${deltaClass(a.delta_pct)}">${pct(a.delta_pct)}</td>
        <td><span class="trigger-tag ${t.cls}">${t.label}</span></td>
      </tr>`;
    });
    html += `</tbody></table><div class="hint">Clicca su una riga per visualizzare il trend a 30 giorni.</div></div>`;
  }

  html += `<div id="trend-section"></div>`;
  cont.innerHTML = html;

  cont.querySelectorAll(".acc-row").forEach(row=>{
    row.addEventListener("click", ()=>{
      cont.querySelectorAll(".acc-row").forEach(r=>r.classList.remove("active"));
      row.classList.add("active");
      showTrendFor(row.dataset.aid, row.dataset.name, row.dataset.plat);
    });
  });

  // Auto-show first alert trend
  const firstRow = cont.querySelector(".acc-row");
  if(firstRow){ firstRow.click(); }
}

function showTrendFor(accountId, accountName, platform){
  destroyCharts();
  const host = document.getElementById("trend-section");
  const trend = (state.current.trend_30d || {})[accountId];
  if(!trend || !trend.length){
    host.innerHTML = `<div class="section"><div class="empty-state">Trend a 30 giorni non disponibile per questo account.</div></div>`;
    return;
  }
  const total = trend.reduce((s,p)=>s+(+p.spend||0),0);
  const days = trend.filter(p=> (+p.spend)>0).length;
  host.innerHTML = `<div class="section">
    <h2>📈 Trend 30 giorni — ${accountName}</h2>
    <div class="chart-wrap">
      <div class="chart-title">Spend giornaliero <small>Totale ${eur(total)} · ${days}/${trend.length} giorni attivi</small></div>
      <div class="chart-host"><canvas id="chart-main"></canvas></div>
    </div>
  </div>`;
  renderChart("chart-main", accountId, accountName, platform);
}

async function loadCheck(date){
  try{
    state.current = await loadJSON(DATA_BASE + date + ".json");
    document.getElementById("meta-info").textContent = `Check del ${fmtDate(date)} · ${state.current.summary.alerts_total} alert`;
    renderSidebar();
    renderAlerts();
  }catch(e){
    document.getElementById("content").innerHTML = `<div class="section"><div class="empty-state">Errore caricamento check: ${e.message}</div></div>`;
  }
}

async function init(){
  // optional ?date= deep link
  const urlDate = new URLSearchParams(location.search).get("date");
  try{
    state.index = await loadJSON(DATA_BASE + "index.json");
    // sort checks desc by date
    state.index.checks.sort((a,b)=> b.date.localeCompare(a.date));
    renderSidebar();
    const target = urlDate && state.index.checks.find(c=>c.date===urlDate) ? urlDate : state.index.checks[0]?.date;
    if(target) await loadCheck(target);
    else document.getElementById("content").innerHTML = '<div class="section"><div class="empty-state">Nessun check ancora disponibile.</div></div>';
  }catch(e){
    document.getElementById("content").innerHTML = `<div class="section"><div class="empty-state">Impossibile caricare l'indice: ${e.message}</div></div>`;
  }
}

init();
