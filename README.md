# FMM Anomalie Spending — Dashboard

Dashboard statica per visualizzare lo storico dei check giornalieri di **spending pubblicitario** (Meta · Google Ads · TikTok) gestiti da FMM Consulting, alimentata da Windsor.ai.

Sito live: `https://<USERNAME>.github.io/fmm-anomalie-spending/`

## Struttura

```
fmm-anomalie-spending/
├── docs/                     ← root di GitHub Pages
│   ├── index.html
│   ├── assets/
│   │   ├── style.css
│   │   └── app.js            ← logica client (fetch JSON, render tabelle + Chart.js)
│   └── data/
│       ├── index.json        ← elenco di tutti i check (ordinato desc)
│       └── YYYY-MM-DD.json   ← snapshot singolo check (alert + trend 30gg)
├── scripts/
│   └── publish_snapshot.py   ← script che il task schedulato esegue per pushare un nuovo snapshot
├── .nojekyll
└── README.md
```

## Schema snapshot (`docs/data/YYYY-MM-DD.json`)

```json
{
  "run_date": "2026-05-15",
  "executed_at": "2026-05-16T07:00:00+00:00",
  "summary": {
    "accounts_checked": {"Meta": 42, "Google": 16, "TikTok": 5},
    "alerts_total": 26,
    "zero_count": 9,
    "spike_count": 17
  },
  "excluded_accounts": [{"platform":"Meta","account_id":"...","name":"..."}],
  "zero_alerts": [
    {"platform":"Meta","account_id":"...","name":"...","spend_yest":0,"avg7":29.84,"triggers":["zero"],"cause":"..."}
  ],
  "spike_alerts": [
    {"platform":"Meta","account_id":"...","name":"...","spend_yest":110.16,"avg7":120.01,"delta_pct":-8.2,"triggers":[">50€"]}
  ],
  "trend_30d": {
    "<account_id>": [{"date":"2026-04-16","spend":54.99}, ...]
  }
}
```

## Come funziona

1. Ogni mattina lo scheduled task del Cowork di Francesco gira la skill `alert-spending-anomalie-windsor`.
2. La skill recupera i dati Windsor (Meta/Google/TikTok), calcola gli alert e genera lo snapshot JSON.
3. Lo script `scripts/publish_snapshot.py` clona il repo, aggiunge `docs/data/YYYY-MM-DD.json`, aggiorna `docs/data/index.json` e fa `git push`.
4. Su Slack viene inviato un messaggio compatto con il link diretto allo snapshot del giorno: `https://<USERNAME>.github.io/fmm-anomalie-spending/?date=YYYY-MM-DD`.

## Setup

Vedi `SETUP.md` (incluso nella consegna iniziale) per: creazione repo, abilitazione GitHub Pages, generazione PAT e aggiornamento dello scheduled task.

## Sviluppo locale

Aprire `docs/index.html` con un server statico:

```bash
cd docs && python3 -m http.server 8080
```

Poi `http://localhost:8080`.
