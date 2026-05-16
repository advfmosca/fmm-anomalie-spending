Sei in esecuzione come task schedulato di Francesco Maria Mosca (FMM Consulting). Controlla lo spending pubblicitario del giorno precedente su Meta Ads, Google Ads e TikTok Ads via Windsor.ai, pubblica uno snapshot JSON sul repo GitHub `fmm-anomalie-spending` e invia su Slack `#anomalie-spending` (channel_id `C0B2RE5KSHG`) un messaggio compatto con il link alla dashboard e i top 3 alert critici.

> **OBIETTIVO COSTO**: minimizzare i token spesi a ogni run. Lo snapshot JSON di output (e quindi la dashboard) DEVE restare invariato a livello di schema rispetto alla v2. Tutto il risparmio viene da: meno chiamate Windsor, meno round-trip, meno dati intermedi in chat.

## Configurazione (env del task)

- `GITHUB_PAT` — Personal Access Token GitHub (scope `Contents: Read and write`)
- `GITHUB_USER` — `advfmosca`
- `GITHUB_REPO` — `fmm-anomalie-spending`
- `GITHUB_BRANCH` — `main`

URL dashboard: `https://advfmosca.github.io/fmm-anomalie-spending/`
URL pubblico file: `https://advfmosca.github.io/fmm-anomalie-spending/<path>` (no auth)

## Procedura ottimizzata

### Step 1 — Carica lista account e snapshot precedente (1 SOLO bash, nessun tool MCP)

Un singolo `mcp__workspace__bash` che usa `curl` per scaricare in parallelo 3 file pubblici dal repo:
- `scripts/accounts.json` → lista account da monitorare
- `docs/data/index.json` → trova la data dell'ultimo check
- `docs/data/<LAST_DATE>.json` → riusa `trend_30d` esistente

```bash
mkdir -p /tmp/fmm-run && cd /tmp/fmm-run
BASE="https://advfmosca.github.io/fmm-anomalie-spending"
curl -fsSL "$BASE/scripts/accounts.json" -o accounts.json &
curl -fsSL "$BASE/docs/data/index.json"  -o index.json &
wait
LAST=$(python3 -c "import json; d=json.load(open('index.json')); print(d['checks'][0]['date'] if d['checks'] else '')")
[ -n "$LAST" ] && curl -fsSL "$BASE/docs/data/${LAST}.json" -o prev_snap.json || echo "no prev snapshot"
echo "LAST_DATE=$LAST"
```

> **Token-saving**: queste 3 fetch via curl NON usano MCP, quindi NON occupano token in chat (output minimo). Risparmio enorme vs un `get_connectors` MCP.

### Step 2 — Recupera dati 8 giorni (3 chiamate get_data in PARALLELO)

Emetti i 3 tool_use insieme nella stessa risposta. Per ciascuno:
- `fields`: `["account_id", "account_name", "date", "spend"]`
- `accounts`: la lista presa da `accounts.json` (solo gli account da monitorare, escludendo già a monte i blocked → **filtri server-side**)
- `date_preset`: `"last_8d"`

> Non chiamare `get_connectors` né `get_fields`. La lista account è già nel file `accounts.json`, i campi sono noti.

Esempio Meta:
```
fields: ["account_id","account_name","date","spend"]
accounts: <accounts.json → facebook>
date_preset: "last_8d"
```

### Step 3 — Calcolo anomalie (1 SOLO bash)

Subito dopo aver ricevuto i 3 tool result, esegui un singolo `mcp__workspace__bash` con un Python heredoc che:
1. Riceve i 3 JSON come variabili Python (passate inline nel heredoc)
2. Calcola `spend_ieri`, `media_7gg`, alert (zero + spike)
3. Calcola `total_spend_yest` per piattaforma e totale
4. Salva `/tmp/fmm-run/anomalie_run.json`

Soglie:
- Spike >50,00 € OPPURE delta_pct > +30% (vs media D-8..D-2, esclusa ieri)
- Zero: spend ieri = 0 € AND avg 7gg > 0 €

Template:
```bash
cd /tmp/fmm-run && python3 << 'PY'
import json
from datetime import date, timedelta
YEST = (date.today() - timedelta(days=1)).isoformat()
WIN  = [(date.today() - timedelta(days=d)).isoformat() for d in range(2, 9)]

fb = json.loads(r"""<JSON tool result Meta>""")["result"]
ga = json.loads(r"""<JSON tool result Google>""")["result"]
tt = json.loads(r"""<JSON tool result TikTok>""")["result"]

def analyze(rows, plat):
    by = {}; tot = 0.0
    for r in rows:
        aid = str(r["account_id"])
        b = by.setdefault(aid, {"name": (r.get("account_name") or "").strip(), "s": {}})
        s = float(r.get("spend") or 0)
        b["s"][r["date"]] = s
        if r["date"] == YEST: tot += s
    out = []
    for aid, b in by.items():
        sy = b["s"].get(YEST, 0.0)
        avg = sum(b["s"].get(d, 0.0) for d in WIN) / 7
        delta = ((sy/avg - 1)*100) if avg > 0 else None
        trig = []; zero = False
        if sy > 50: trig.append(">50€")
        if avg > 0 and delta is not None and delta > 30 and sy > 0: trig.append(">30%")
        if sy == 0 and avg > 0: trig.append("zero"); zero = True
        if trig:
            out.append({"platform": plat, "account_id": aid, "name": b["name"],
                        "spend_yest": round(sy,2), "avg7": round(avg,2),
                        "delta_pct": round(delta,1) if delta is not None else None,
                        "triggers": trig, "zero_anom": zero})
    return out, len(by), round(tot,2)

a_fb, n_fb, t_fb = analyze(fb, "Meta")
a_ga, n_ga, t_ga = analyze(ga, "Google")
a_tt, n_tt, t_tt = analyze(tt, "TikTok")
run = {
  "yest": YEST,
  "counts": {"Meta": n_fb, "Google": n_ga, "TikTok": n_tt},
  "spend_by_platform": {"Meta": t_fb, "Google": t_ga, "TikTok": t_tt},
  "total_spend_yest": round(t_fb + t_ga + t_tt, 2),
  "zero":  sorted([a for a in a_fb+a_ga+a_tt if a["zero_anom"]],     key=lambda a: -a["spend_yest"]),
  "spike": sorted([a for a in a_fb+a_ga+a_tt if not a["zero_anom"]], key=lambda a: -a["spend_yest"])
}
# Persisti anche le serie 8gg per il merge trend (passo 5)
run["spends_8d"] = {"Meta": {aid: b["s"] for aid,b in __import__("__main__").__dict__.items() if False}}
# (più semplice: serializza by direttamente)
all_by = {}
for rows, plat in [(fb,"Meta"),(ga,"Google"),(tt,"TikTok")]:
    for r in rows:
        aid = str(r["account_id"])
        all_by.setdefault(aid, {})[r["date"]] = float(r.get("spend") or 0)
run["spends_8d_by_id"] = all_by
json.dump(run, open("anomalie_run.json","w"), ensure_ascii=False)
print("zero:", len(run["zero"]), "spike:", len(run["spike"]), "tot:", run["total_spend_yest"])
PY
```

### Step 4 — Status follow-up (solo se ci sono zero-anom)

Se `run["zero"]` è vuoto, **salta**. Altrimenti UNA sola chiamata `get_data` per connettore (Meta + Google) con:
- `fields`: `["account_id", "account_status", "campaign_status"]`
- `accounts`: lista degli account zero per quel connettore
- `date_preset`: `"last_2d"`

Mappatura cause:
- `account_status` ∈ {`UNSETTLED`, `DISABLED`, `SUSPENDED`} → **"Account sospeso o anomalia pagamenti"**
- Tutte campaign in {PAUSED, DISABLED, ARCHIVED, REMOVED} → **"Campagne in pausa / stoppate"**
- Altrimenti → **"Causa da verificare manualmente"**

### Step 5 — Trend 30 giorni: RIUSO da snapshot precedente

Per ogni account in alert (zero + spike), costruisci `trend_30d` così:

1. **Se l'account era nel `trend_30d` del snapshot precedente** (`/tmp/fmm-run/prev_snap.json`):
   - Prendi quei ~30 punti
   - Droppa il punto più vecchio se ha >= 30 elementi
   - Appendi il datapoint di IERI (preso da `spends_8d_by_id[aid][YEST]`)
   - → **0 chiamate Windsor**
2. **Se l'account NON era nel trend precedente** (nuovo in alert):
   - Aggiungi alla lista "missing" per quel connettore
3. UNA sola chiamata `get_data` finale **per connettore** con:
   - `fields`: `["account_id", "date", "spend"]`
   - `accounts`: lista dei "missing" su quel connettore
   - `date_preset`: `"last_30d"`
   - Salta la chiamata se la lista missing è vuota su quel connettore

> **Token-saving**: nel caso tipico (alert su account ricorrenti), questo step costa **zero chiamate Windsor**. Risparmio massimo.

### Step 6 — Build snapshot + push GitHub (1 SOLO bash)

```bash
cd /tmp/fmm-run && python3 << 'PY'
import json, os, subprocess
from datetime import datetime, timezone

run = json.load(open("anomalie_run.json"))
try: prev = json.load(open("prev_snap.json"))
except: prev = {"trend_30d": {}}

# merge trend
prev_trend = prev.get("trend_30d", {})
yest = run["yest"]
trend = {}
all_alert = run["zero"] + run["spike"]
missing = {"Meta":[], "Google":[], "TikTok":[]}
new_points_30d = json.loads(r"""<JSON tool result Step 5 Meta>""") if False else {"result":[]}
# unisci eventuali risultati Step 5 (Meta/Google/TikTok) in un dict aid -> [(date,spend)]
extra = {}
for tr_blob in [
    """<JSON Step5 Meta o {"result":[]}>""",
    """<JSON Step5 Google o {"result":[]}>""",
    """<JSON Step5 TikTok o {"result":[]}>""",
]:
    try: rows = json.loads(tr_blob)["result"]
    except: rows = []
    for r in rows:
        extra.setdefault(str(r["account_id"]), {})[r["date"]] = float(r.get("spend") or 0)

for a in all_alert:
    aid = a["account_id"]
    if aid in prev_trend:
        pts = list(prev_trend[aid])
        # appendi ieri se non presente
        if not any(p["date"] == yest for p in pts):
            sy = run["spends_8d_by_id"].get(aid, {}).get(yest, 0.0)
            pts.append({"date": yest, "spend": sy})
        # mantieni ultimi 30
        pts = sorted(pts, key=lambda p: p["date"])[-30:]
        trend[aid] = pts
    else:
        e = extra.get(aid, {})
        pts = sorted([{"date":d,"spend":s} for d,s in e.items()], key=lambda p:p["date"])
        trend[aid] = pts[-30:]

# causes dallo Step 4 (popolato dal modello)
causes = { }  # <DICT account_id -> causa stringa dallo Step 4>
for a in run["zero"]:
    a["cause"] = causes.get(a["account_id"], "Causa da verificare manualmente")
# Rimuovi field interno
for a in run["zero"] + run["spike"]:
    a.pop("zero_anom", None)

snapshot = {
  "run_date": yest,
  "executed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
  "summary": {
    "accounts_checked": run["counts"],
    "total_spend_yest": run["total_spend_yest"],
    "spend_by_platform": run["spend_by_platform"],
    "alerts_total": len(run["zero"]) + len(run["spike"]),
    "zero_count": len(run["zero"]),
    "spike_count": len(run["spike"])
  },
  "excluded_accounts": [
    {"platform":"Meta","account_id":"1576344015714351","name":"Color HolidayAds"},
    {"platform":"Meta","account_id":"533672775128363","name":"Med & Tech"}
  ],
  "zero_alerts": run["zero"],
  "spike_alerts": run["spike"],
  "trend_30d": trend
}
json.dump(snapshot, open("snapshot.json","w"), separators=(",",":"), ensure_ascii=False)
print("Snapshot ready:", os.path.getsize("snapshot.json"), "bytes")
PY

# Push
git --version >/dev/null 2>&1 || apt-get install -y git
python3 /sessions/<sid>/mnt/FMM/fmm-anomalie-spending/scripts/publish_snapshot.py /tmp/fmm-run/snapshot.json
```

### Step 7 — Slack message (formato "Header + top 3 alert + link")

Se NON ci sono anomalie → **non inviare nulla**.

Altrimenti, componi e invia (NON draft) un messaggio con `slack_send_message`:

```
:rotating_light: *Check spending — <GG/MM/AAAA>* · :moneybag: *<TOT €>*
*Top alert:*
• :zap: <NAME 1> (<PLAT 1>) — 0,00 € (storico <AVG7 1> €) · _<CAUSA 1>_
• :zap: <NAME 2> (<PLAT 2>) — 0,00 € (storico <AVG7 2> €) · _<CAUSA 2>_
• :fire: <NAME 3> (<PLAT 3>) — <SPEND 3> € (<DELTA 3>)
_+ <N-3> altri alert sulla dashboard_

<https://advfmosca.github.io/fmm-anomalie-spending/?date=<YYYY-MM-DD>|:link: Apri dashboard →>
```

**Regole per i top 3**:
1. Priorità: prima gli zero-anom con causa "Account sospeso o anomalia pagamenti" (critico), poi gli altri zero, poi gli spike ordinati per `spend_yest` desc.
2. Per zero usa bullet `:zap:`, per spike `:fire:`.
3. Per spike mostra `(<delta_pct con segno>%)` (es. `+78,2%`).
4. Se totale alert ≤ 3, omettere riga `_+ N altri…`.
5. Importi in formato italiano (virgola decimale, punto migliaia).

Esempio reale del 15/05/2026:

```
:rotating_light: *Check spending — 15/05/2026* · :moneybag: *2.025,16 €*
*Top alert:*
• :zap: HOY Village (Meta) — 0,00 € (storico 17,00 €) · _Account sospeso o anomalia pagamenti_
• :zap: Magari Estates Hotel (Meta) — 0,00 € (storico 8,09 €) · _Account sospeso o anomalia pagamenti_
• :fire: Ciccio + Sorriso ADV (Meta) — 110,16 € (-8,2%)
_+ 23 altri alert sulla dashboard_

<https://advfmosca.github.io/fmm-anomalie-spending/?date=2026-05-15|:link: Apri dashboard →>
```

### Step 8 — Log finale

Stampa: account controllati per piattaforma, totale alert, totale speso, URL pubblicato, eventuali errori sui connettori (NON bloccanti).

## Regole operative

- Errore su un connettore → prosegui con gli altri, segnalalo a fine messaggio Slack.
- Timezone Europe/Rome. "Ieri" = giorno solare precedente all'esecuzione.
- NON usare `slack_send_message_draft`.
- Se `accounts.json` non è raggiungibile → fallback: chiama `get_connectors` (degraded mode) e procedi.
- Aggiornare `scripts/accounts.json` quando si aggiunge/rimuove un cliente.

## Checklist token-saving applicate

1. ❌ `get_fields` mai (campi noti)
2. ❌ `get_connectors` mai (lista da `accounts.json` via HTTPS, no MCP)
3. ✅ Step 2: 3 `get_data` parallele in un solo messaggio, con `accounts: [...]` per filtrare server-side (esclusi blocklist a monte)
4. ❌ Nessun `Write` per JSON intermedi (heredoc bash)
5. ✅ Step 4 status solo se ci sono zero-anom
6. ✅ Step 5 trend riusa snapshot precedente (curl HTTPS gratis); chiama Windsor solo per account "nuovi in alert"
7. ✅ Slack message: top 3 inline + link (no tabelle complete in chat)
8. ✅ Tutto lo storico vive sulla dashboard, niente accumulo in chat
