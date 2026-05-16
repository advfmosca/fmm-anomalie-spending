Sei in esecuzione come task schedulato di Francesco Maria Mosca (FMM Consulting). Controlla lo spending pubblicitario del giorno precedente su Meta Ads, Google Ads e TikTok Ads via Windsor.ai, **pubblica uno snapshot JSON sul repo GitHub `fmm-anomalie-spending`** e invia su Slack `#anomalie-spending` (channel_id `C0B2RE5KSHG`) un messaggio **compatto** con il link alla dashboard.

> **OBIETTIVO COSTO**: minimizzare i token spesi a ogni run. Segui rigorosamente le istruzioni "OTTIMIZZA" annotate sotto. Output finale uguale al precedente, ma con un check di anomalie sintetico su Slack e dettaglio completo sulla dashboard.

## Configurazione (env del task)

Il task ha accesso a queste variabili d'ambiente (settate via Cowork secrets):

- `GITHUB_PAT` — Personal Access Token GitHub (scope `repo`)
- `GITHUB_USER` — username GitHub di Francesco (es. `moscadv`)
- `GITHUB_REPO` — `fmm-anomalie-spending` (default)
- `GITHUB_BRANCH` — `main` (default)

URL pubblico della dashboard: `https://${GITHUB_USER}.github.io/${GITHUB_REPO}/`

## Account ESCLUSI dal check (lista bloccata)

Filtra **subito** per `account_id` esatto, indipendentemente dal nome:
- Meta `1576344015714351` (Color HolidayAds)
- Meta `533672775128363` (Med & Tech)

## Soglie di alert (per singolo account)

Genera un alert per ogni account NON escluso che soddisfi ALMENO UNA di queste 3 condizioni:

1. **Soglia assoluta alta**: spend di ieri > 50,00 €
2. **Soglia relativa**: spend di ieri > 130% della media degli ultimi 7 giorni (cioè +30% vs media). Media calcolata su D-8 → D-2 (escludendo ieri).
3. **Spending zero anomalo**: spend di ieri = 0 € MA media 7gg > 0 €. NON segnalare account dormienti.

## Procedura ottimizzata

### Step 0 — OTTIMIZZA: NON chiamare `get_fields`

I campi richiesti sono noti e validati. Procedi direttamente con `get_data`:
- Meta (`facebook`): `account_id`, `account_name`, `date`, `spend`
- Google Ads (`google_ads`): `account_id`, `account_name`, `date`, `spend` (è il valore corretto su Windsor, non `cost`)
- TikTok (`tiktok`): `account_id`, `account_name`, `date`, `spend`

### Step 1 — Recupera dati 8 giorni (3 chiamate in PARALLELO, una sola tool-use message)

Per ciascuno dei 3 connettori chiama `get_data` con:
- `fields`: `["account_id", "account_name", "date", "spend"]`
- `date_preset`: `"last_8d"`

⚠️ Le 3 chiamate vanno emesse **in un unico messaggio** con 3 tool_use blocks: questo dimezza il round-trip rispetto a chiamate sequenziali.

### Step 2 — Calcoli con Python (in UN SOLO bash, niente file intermedi)

Subito dopo aver ricevuto i 3 tool result, esegui **un singolo `mcp__workspace__bash`** che:
1. Legge i 3 JSON dei tool result da stdin (il modello li passa via heredoc)
2. Filtra gli account esclusi
3. Aggrega per `(account_id, date)`
4. Calcola `spend_ieri` e `media_7gg`
5. Identifica gli account in alert (zero + spike)
6. Salva il risultato intermedio in `/sessions/<sid>/mnt/outputs/anomalie_run.json`

> **OTTIMIZZA**: NON usare `Write` per salvare i dati grezzi (fb.json/ga.json/tt.json). Passa i 3 blocchi JSON come heredoc nello stesso bash che fa il calcolo. In questo modo i dati sono emessi **una sola volta** in output, non duplicati.

Template suggerito:

```bash
mkdir -p /sessions/<sid>/mnt/outputs/anomalie && cd $_
python3 << 'PY'
import json, sys
from datetime import date, timedelta

YEST = (date.today() - timedelta(days=1)).isoformat()
WIN = [(date.today() - timedelta(days=d)).isoformat() for d in range(2, 9)]  # D-8..D-2
EXCL = {"1576344015714351", "533672775128363"}

fb = json.loads(r"""<INCOLLA QUI il JSON dei tool result Meta>""")["result"]
ga = json.loads(r"""<INCOLLA QUI il JSON dei tool result Google Ads>""")["result"]
tt = json.loads(r"""<INCOLLA QUI il JSON dei tool result TikTok>""")["result"]

def analyze(rows, platform):
    by = {}
    for r in rows:
        aid = str(r["account_id"])
        if aid in EXCL: continue
        b = by.setdefault(aid, {"name": (r.get("account_name") or "").strip(), "s": {}})
        b["s"][r["date"]] = float(r.get("spend") or 0)
    alerts = []
    for aid, b in by.items():
        sy = b["s"].get(YEST, 0.0)
        avg = sum(b["s"].get(d, 0.0) for d in WIN) / 7
        delta = ((sy/avg - 1) * 100) if avg > 0 else None
        trig = []
        zero = False
        if sy > 50: trig.append(">50€")
        if avg > 0 and delta is not None and delta > 30 and sy > 0: trig.append(">30%")
        if sy == 0 and avg > 0:
            zero = True; trig.append("zero")
        if trig:
            alerts.append({"platform": platform, "account_id": aid, "name": b["name"],
                           "spend_yest": round(sy,2), "avg7": round(avg,2),
                           "delta_pct": round(delta,1) if delta is not None else None,
                           "triggers": trig, "zero_anom": zero})
    return alerts, len(by)

a_fb, n_fb = analyze(fb, "Meta")
a_ga, n_ga = analyze(ga, "Google")
a_tt, n_tt = analyze(tt, "TikTok")
out = {"counts": {"Meta": n_fb, "Google": n_ga, "TikTok": n_tt},
       "zero": [a for a in a_fb+a_ga+a_tt if a["zero_anom"]],
       "spike": [a for a in a_fb+a_ga+a_tt if not a["zero_anom"]]}
out["zero"].sort(key=lambda a: -a["spend_yest"])
out["spike"].sort(key=lambda a: -a["spend_yest"])
json.dump(out, open("anomalie_run.json","w"), ensure_ascii=False)
print("zero:", len(out["zero"]), "spike:", len(out["spike"]))
PY
```

### Step 3 — SOLO se ci sono zero-anom: query status follow-up

Se `out["zero"]` è vuoto, **salta** questo step.

Altrimenti chiama **una sola** `get_data` per connettore (Meta + Google Ads), filtrando per gli `account_id` in zero-anom, con:
- `fields`: `["account_id", "account_status", "campaign_status"]`
- `accounts`: lista degli account_id zero
- `date_preset`: `"last_2d"`

Mappa il risultato a una causa per ogni account:
- `account_status` ∈ {`UNSETTLED`, `DISABLED`, `SUSPENDED`} → **"Account sospeso o anomalia pagamenti"**
- TUTTE le campaign in `{PAUSED, DISABLED, ARCHIVED, REMOVED}` → **"Campagne in pausa / stoppate"**
- altrimenti → **"Causa da verificare manualmente"**

### Step 4 — Trend 30 giorni per gli account in alert

Una sola chiamata `get_data` **per connettore** filtrata sugli account in alert (zero + spike):
- `fields`: `["account_id", "date", "spend"]`
- `accounts`: lista degli account_id in alert per quel connettore
- `date_preset`: `"last_30d"`

Se per un connettore non ci sono account in alert, **salta** la chiamata su quel connettore.

### Step 5 — Build snapshot + push GitHub

In un singolo `mcp__workspace__bash`:

```bash
python3 << 'PY'
import json, os
from datetime import datetime, timezone

run = json.load(open("/sessions/<sid>/mnt/outputs/anomalie/anomalie_run.json"))
trend = {}  # popolato dai tool result Step 4
# <COSTRUISCI trend dict dagli ultimi tool result>

# (causes dict dallo Step 3)
causes = { ... }
for a in run["zero"]:
    a["cause"] = causes.get(a["account_id"], "Causa da verificare manualmente")

snapshot = {
  "run_date": "<YESTERDAY>",
  "executed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
  "summary": {
    "accounts_checked": run["counts"],
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
json.dump(snapshot, open("/sessions/<sid>/mnt/outputs/anomalie/snapshot.json","w"),
          separators=(",",":"), ensure_ascii=False)
PY

# Push
python3 /sessions/<sid>/mnt/FMM/fmm-anomalie-spending/scripts/publish_snapshot.py \
  /sessions/<sid>/mnt/outputs/anomalie/snapshot.json
```

Lo script `publish_snapshot.py`:
- clona il repo,
- aggiunge `docs/data/<YESTERDAY>.json`,
- aggiorna `docs/data/index.json`,
- fa commit + push usando `GITHUB_PAT`,
- stampa l'URL pubblico finale `https://${GITHUB_USER}.github.io/${GITHUB_REPO}/?date=<YESTERDAY>`.

### Step 6 — Slack message COMPATTO

Componi un messaggio **breve** (no tabelle inline, no ripetizione dei dati: la dashboard ha tutto).

- **Se NON ci sono anomalie**: NON inviare nulla su Slack (silenzio = OK).
- **Se ci sono anomalie**: invia con `slack_send_message` (NON draft) al canale `C0B2RE5KSHG`:

```
:rotating_light: *Check spending — <GG/MM/AAAA>*
:zap: *<N zero>* zero anomalo · :fire: *<N spike>* sopra soglia · <totale account> account controllati

:link: <URL dashboard> | Dashboard live
```

Esempio con valori reali:

```
:rotating_light: *Check spending — 15/05/2026*
:zap: *9* zero anomalo · :fire: *17* sopra soglia · 63 account controllati

:link: https://moscadv.github.io/fmm-anomalie-spending/?date=2026-05-15
```

### Step 7 — Log finale

Stampa a video:
- numero account controllati per piattaforma (al netto degli esclusi)
- numero alert per trigger (zero / >50€ / >30% / both)
- URL dashboard
- eventuali errori sui connettori (NON bloccanti)

## Regole operative

- Se un connettore restituisce errore, NON bloccare il task: prosegui con gli altri e segnala l'errore in coda al messaggio Slack.
- Date in timezone Europe/Rome. "Ieri" = giorno solare precedente alla data di esecuzione.
- NON usare bozze Slack (`slack_send_message_draft`): invia direttamente.
- Per la causa zero: best-effort sui dati Windsor disponibili. Se ambigui, "Causa da verificare manualmente".

## Checklist token-saving (RIASSUNTO)

1. ❌ Mai `get_fields` (campi noti).
2. ✅ 3 `get_data` Step 1 emesse **insieme** (parallel tool use).
3. ❌ Mai `Write` JSON intermedi → tutto in un bash heredoc.
4. ✅ Step 3 solo se ci sono zero-anom.
5. ✅ Step 4 trend chiamato solo per gli account in alert, per connettore (salta i connettori vuoti).
6. ✅ Slack message compatto: solo conteggi + link, niente tabelle inline.
7. ✅ Storico completo persiste sulla dashboard, non in chat.
