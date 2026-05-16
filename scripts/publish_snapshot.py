#!/usr/bin/env python3
"""
publish_snapshot.py — pubblica uno snapshot JSON sulla dashboard FMM Anomalie Spending.

Uso (dal task schedulato):
    GITHUB_PAT=ghp_xxx \
    GITHUB_USER=moscadv \
    GITHUB_REPO=fmm-anomalie-spending \
    python3 publish_snapshot.py /path/to/snapshot.json

Lo snapshot.json deve avere la struttura definita in README.md.
Lo script:
  1. clona (shallow) il repo in una temp dir
  2. scrive docs/data/{run_date}.json e aggiorna docs/data/index.json
  3. fa commit + push con il PAT
  4. stampa l'URL pubblico finale (utile per costruire il link Slack)

Dipende solo da: python3 stdlib + git installato.
"""
from __future__ import annotations
import json, os, subprocess, sys, tempfile, shutil
from datetime import datetime, timezone

def run(cmd, cwd=None, check=True, capture=False):
    r = subprocess.run(cmd, cwd=cwd, check=check, text=True,
                       capture_output=capture)
    return r

def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: publish_snapshot.py <snapshot.json>")
    snap_path = sys.argv[1]
    if not os.path.exists(snap_path):
        sys.exit(f"Snapshot not found: {snap_path}")

    pat = os.environ.get("GITHUB_PAT")
    user = os.environ.get("GITHUB_USER")
    repo = os.environ.get("GITHUB_REPO", "fmm-anomalie-spending")
    branch = os.environ.get("GITHUB_BRANCH", "main")
    git_email = os.environ.get("GIT_EMAIL", "bot@fmmconsulting.it")
    git_name = os.environ.get("GIT_NAME", "FMM Anomalie Bot")
    if not pat or not user:
        sys.exit("Missing env: GITHUB_PAT and/or GITHUB_USER")

    with open(snap_path, encoding="utf-8") as f:
        snap = json.load(f)
    run_date = snap.get("run_date")
    if not run_date:
        sys.exit("Snapshot missing run_date")

    tmp = tempfile.mkdtemp(prefix="fmm-anomalie-")
    try:
        clone_url = f"https://{user}:{pat}@github.com/{user}/{repo}.git"
        run(["git", "clone", "--depth", "1", "--branch", branch, clone_url, tmp])
        run(["git", "config", "user.email", git_email], cwd=tmp)
        run(["git", "config", "user.name", git_name], cwd=tmp)

        data_dir = os.path.join(tmp, "docs", "data")
        os.makedirs(data_dir, exist_ok=True)

        # write snapshot
        out_snap = os.path.join(data_dir, f"{run_date}.json")
        with open(out_snap, "w", encoding="utf-8") as f:
            json.dump(snap, f, separators=(",", ":"), ensure_ascii=False)

        # update index
        idx_path = os.path.join(data_dir, "index.json")
        if os.path.exists(idx_path):
            with open(idx_path, encoding="utf-8") as f:
                idx = json.load(f)
        else:
            idx = {"last_updated": None, "checks": []}
        idx["checks"] = [c for c in idx.get("checks", []) if c.get("date") != run_date]
        idx["checks"].append({
            "date": run_date,
            "alerts_total": snap["summary"]["alerts_total"],
            "zero": snap["summary"]["zero_count"],
            "spike": snap["summary"]["spike_count"],
            "accounts_checked": sum(snap["summary"].get("accounts_checked", {}).values()),
        })
        idx["checks"].sort(key=lambda c: c["date"], reverse=True)
        idx["last_updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with open(idx_path, "w", encoding="utf-8") as f:
            json.dump(idx, f, indent=2, ensure_ascii=False)

        # commit + push (no-op tolerant)
        run(["git", "add", "docs/data/"], cwd=tmp)
        status = run(["git", "status", "--porcelain"], cwd=tmp, capture=True).stdout
        if not status.strip():
            print("No changes to commit.")
        else:
            msg = f"check {run_date}: {snap['summary']['alerts_total']} alert ({snap['summary']['zero_count']} zero, {snap['summary']['spike_count']} spike)"
            run(["git", "commit", "-m", msg], cwd=tmp)
            run(["git", "push", "origin", branch], cwd=tmp)

        public_url = f"https://{user}.github.io/{repo}/?date={run_date}"
        print(public_url)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
