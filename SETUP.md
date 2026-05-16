# SETUP — Deploy della dashboard FMM Anomalie Spending

Tempo stimato: **~10 minuti**. Da fare **una sola volta**.

## 1. Crea il repository GitHub

1. Vai su https://github.com/new
2. Compila:
   - **Repository name**: `fmm-anomalie-spending`
   - **Description**: `Dashboard storico anomalie spending Meta/Google/TikTok via Windsor.ai`
   - **Public** (richiesto per GitHub Pages gratuito)
   - **NON** aggiungere README/.gitignore (sono già nel pacchetto)
3. Click "Create repository". Annota lo username (es. `moscadv`).

## 2. Push iniziale del codice della dashboard

Dal terminale, nella cartella `/Users/francescomariamosca/Desktop/FMM/fmm-anomalie-spending/`:

```bash
cd "/Users/francescomariamosca/Desktop/FMM/fmm-anomalie-spending"
git init -b main
git add .
git commit -m "initial dashboard scaffold + 2026-05-15 snapshot"
git remote add origin https://github.com/<TUO_USERNAME>/fmm-anomalie-spending.git
git push -u origin main
```

Quando richiesto, autenticati con il tuo username e usando un PAT come password (vedi step 4 qui sotto — puoi crearlo prima e usarlo qui).

## 3. Abilita GitHub Pages

1. Vai su https://github.com/`<TUO_USERNAME>`/fmm-anomalie-spending/settings/pages
2. Sotto **Build and deployment** → **Source**: seleziona **Deploy from a branch**
3. **Branch**: `main` / **folder**: `/docs`
4. Click **Save**
5. Aspetta 1–2 minuti, poi apri `https://<TUO_USERNAME>.github.io/fmm-anomalie-spending/`

Dovresti vedere la dashboard con il check del 15/05/2026 già popolato.

## 4. Genera il Personal Access Token (PAT)

1. Vai su https://github.com/settings/tokens?type=beta (fine-grained, consigliato) **oppure** https://github.com/settings/tokens (classic)

   **Opzione A — Fine-grained (consigliato)**:
   - **Token name**: `FMM Anomalie Spending Bot`
   - **Expiration**: 1 anno (o "No expiration" se preferisci)
   - **Repository access**: Only select repositories → `fmm-anomalie-spending`
   - **Repository permissions**:
     - Contents: **Read and write**
     - Metadata: Read-only (auto)
   - **Generate token** → copia subito il valore (inizia con `github_pat_...`)

   **Opzione B — Classic**:
   - **Note**: `FMM Anomalie Spending Bot`
   - Scopes: ✅ `repo` (tutti i sotto-scope)
   - **Generate token** → copia il valore (inizia con `ghp_...`)

⚠️ **Salva il token in modo sicuro**: GitHub te lo mostra una sola volta.

## 5. Aggiorna lo scheduled task del Cowork

Apri il task schedulato `alert-spending-anomalie-windsor` su Cowork e:

1. **Sostituisci il file SKILL.md** con quello consegnato in `/Users/francescomariamosca/Desktop/FMM/fmm-anomalie-spending/SKILL.md` (la versione v2 ottimizzata).

2. **Aggiungi le variabili d'ambiente** al task (Cowork → Scheduled Tasks → il tuo task → Secrets/Env):
   - `GITHUB_PAT` = `<incolla qui il PAT>`
   - `GITHUB_USER` = `<TUO_USERNAME>` (es. `moscadv`)
   - `GITHUB_REPO` = `fmm-anomalie-spending` (può anche essere omesso, è il default)

3. **Assicurati che lo script `publish_snapshot.py` sia raggiungibile**:
   - La SKILL.md fa riferimento a `/sessions/<sid>/mnt/FMM/fmm-anomalie-spending/scripts/publish_snapshot.py` — visto che la cartella `FMM` è la tua workspace folder collegata, lo script sarà già disponibile a ogni run.

4. Salva e fai un test run manuale (se Cowork lo consente). Verifica:
   - Compare il messaggio compatto su Slack con il link alla dashboard
   - La dashboard mostra il nuovo check nella sidebar
   - L'URL `?date=YYYY-MM-DD` apre direttamente il check del giorno

## 6. (Opzionale) Personalizza branding

- Logo: modifica `docs/index.html` (riga `<span class="brand-logo">FMM</span>`) o sostituiscilo con un `<img>` puntando a `FMM.png` (può essere copiato in `docs/assets/`).
- Colori: cambia le variabili CSS in `docs/assets/style.css` sotto `:root` (l'accent è arancione `#ff6b35`, in linea con il TOV FMM).

## Troubleshooting

| Problema | Causa probabile | Soluzione |
|---|---|---|
| Dashboard vuota / 404 | Pages non ancora deployato | Aspetta 2 min e ricarica; verifica Settings → Pages |
| Push respinto (403) | PAT scaduto o senza scope `repo` / `Contents: Read and write` | Rigenera PAT |
| Slack message senza link | Variabili env mancanti | Controlla `GITHUB_USER`/`GITHUB_REPO` nei secrets del task |
| Grafico trend vuoto su un account | Account è in alert per la prima volta, manca lo storico Windsor | Normale dopo il primo run; si popola automaticamente |
| Errore `git: not found` durante il task | Git non installato nella sandbox | Aggiungi `apt-get install -y git` all'inizio dello step 5 |

## Riepilogo file consegnati

```
/Users/francescomariamosca/Desktop/FMM/fmm-anomalie-spending/
├── README.md
├── SETUP.md            ← questo file
├── SKILL.md            ← nuovo task v2 da incollare in Cowork
├── .gitignore
├── docs/
│   ├── .nojekyll
│   ├── index.html
│   ├── assets/
│   │   ├── style.css
│   │   └── app.js
│   └── data/
│       ├── index.json
│       └── 2026-05-15.json   ← snapshot del check di stamattina
└── scripts/
    └── publish_snapshot.py
```
