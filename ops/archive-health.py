#!/usr/bin/env python3
import datetime
import json
import os
from pathlib import Path
import subprocess
from wal_archive import backup_root, digest


def main():
    root = backup_root()
    if not os.environ.get("PGSERVICE") or not os.environ.get("PGPASSFILE"):
        raise ValueError("private service required")
    sql = "SELECT row_to_json(t) FROM (SELECT archived_count,failed_count,last_archived_wal,last_archived_time,last_failed_time,current_setting('archive_mode') AS mode,current_setting('archive_timeout') AS timeout FROM pg_stat_archiver) t"
    result = subprocess.run(["psql", "-X", "-A", "-t", "--no-password", "--command", sql], capture_output=True, text=True, timeout=15, check=True)
    row = json.loads(result.stdout)
    if row["mode"] != "on" or not row["last_archived_wal"] or not row["last_archived_time"]:
        raise ValueError("continuous archive not active")
    filename = row["last_archived_wal"]
    if Path(filename).name != filename:
        raise ValueError("invalid archive name")
    path = root / "wal" / filename
    if path.is_symlink() or digest(path) != path.with_name(filename + ".sha256").read_text().strip():
        raise ValueError("latest archive missing or corrupt")
    at = datetime.datetime.fromisoformat(row["last_archived_time"])
    age = (datetime.datetime.now(datetime.timezone.utc) - at).total_seconds()
    ready = 0 <= age <= 900 and (not row["last_failed_time"] or datetime.datetime.fromisoformat(row["last_failed_time"]) <= at)
    print(json.dumps({"archiveHealthy": ready, "secondsSinceArchive": round(age), "archivedCount": row["archived_count"], "failureCount": row["failed_count"], "productionRpoAccepted": False}))
    return 0 if ready else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print('{"archiveHealthy":false,"reason":"ARCHIVE_CHECK_FAILED"}')
        raise SystemExit(1)
