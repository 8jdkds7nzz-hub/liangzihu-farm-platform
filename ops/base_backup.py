#!/usr/bin/env python3
"""Dedicated production cluster only; credentials come from private libpq files."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
from wal_archive import backup_root, sync_directory


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--confirm-dedicated-cluster", action="store_true", required=True)
    a = p.parse_args()
    if not a.confirm_dedicated_cluster or not os.environ.get("PGSERVICE") or not os.environ.get("PGSERVICEFILE") or not os.environ.get("PGPASSFILE"):
        raise ValueError("private libpq service and password files required")
    for key in ("PGSERVICEFILE", "PGPASSFILE"):
        f = Path(os.environ[key])
        if f.is_symlink() or f.stat().st_mode & 0o077:
            raise ValueError("libpq files must be private")
    root = backup_root()
    name = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    destination = root / ("基础备份-" + name)
    destination.mkdir(mode=0o700)
    env = {**os.environ, "PGCONNECT_TIMEOUT": "10"}
    for command in (["pg_basebackup", "--pgdata=" + str(destination), "--format=plain", "--wal-method=stream", "--checkpoint=fast", "--no-password"], ["pg_verifybackup", str(destination)]):
        result = subprocess.run(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3600)
        if result.returncode:
            raise ValueError("base backup or WAL validation failed; incomplete folder retained")
    control = subprocess.run(["pg_controldata", str(destination)], env={**env, "LC_ALL": "C"}, capture_output=True, text=True, check=True).stdout
    identifier = next((line.split(":", 1)[1].strip() for line in control.splitlines() if line.startswith("Database system identifier:")), None)
    if identifier != os.environ["BACKUP_CLUSTER_ID"]:
        raise ValueError("cluster identifier mismatch")
    report = {"clusterId": identifier, "baseBackupVerified": True, "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "walContinuityBeyondBase": "requires archiver and PITR drill", "productionReady": False}
    with open(destination / "基础备份核对.json", "x", opener=lambda p, f: os.open(p, f, 0o600)) as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    sync_directory(destination)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("基础备份未通过；请检查专用集群、私有连接文件、空间及归档链。", file=__import__("sys").stderr)
        raise SystemExit(1)
