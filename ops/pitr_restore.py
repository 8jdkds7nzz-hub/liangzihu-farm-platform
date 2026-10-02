#!/usr/bin/env python3
"""Prepare PITR into a new empty directory; never stop or replace a running DB."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
from wal_archive import backup_root, digest, durable_copy


def restore_wal(name, destination):
    import re
    if not re.fullmatch(r"[A-Za-z0-9.]{1,64}", name) or name in (".", ".."):
        raise ValueError("invalid WAL name")
    root = backup_root()
    original = root / "wal" / name
    checksum = original.with_name(name + ".sha256")
    if checksum.is_symlink() or checksum.read_text().strip() != digest(original):
        raise ValueError("WAL integrity check failed")
    durable_copy(original, destination)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    wal = sub.add_parser("wal")
    wal.add_argument("name")
    wal.add_argument("destination")
    prepare = sub.add_parser("prepare")
    prepare.add_argument("base")
    prepare.add_argument("target")
    prepare.add_argument("--target-time", required=True)
    args = p.parse_args()
    if args.command == "wal":
        restore_wal(args.name, args.destination)
        return
    root = backup_root()
    base, target = Path(args.base), Path(args.target)
    if base.is_symlink() or base.resolve().parent != root.resolve() or target.exists() or not target.is_absolute():
        raise ValueError("only a verified base and a new absolute directory are allowed")
    report = json.loads((base / "基础备份核对.json").read_text())
    if report.get("baseBackupVerified") is not True or report.get("clusterId") != os.environ["BACKUP_CLUSTER_ID"]:
        raise ValueError("base backup not verified")
    at = datetime.datetime.fromisoformat(args.target_time)
    if at.tzinfo is None:
        raise ValueError("recovery target requires timezone")
    import subprocess
    if subprocess.run(["pg_verifybackup", str(base)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3600).returncode:
        raise ValueError("base backup integrity failed")
    shutil.copytree(base, target)
    os.chmod(target, 0o700)
    script = Path(__file__).resolve()
    if "'" in str(script):
        raise ValueError("invalid script path")
    with open(target / "postgresql.auto.conf", "a") as f:
        f.write("\nrestore_command = 'python3 " + str(script) + " wal %f %p'\n")
        f.write("recovery_target_time = '" + at.isoformat() + "'\nrecovery_target_action = 'pause'\n")
    (target / "recovery.signal").touch(mode=0o600)
    print("新目录已准备；另启同版本隔离实例验证目标时间、数据、权限和原件，未替换现有实例。")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("恢复准备未完成；现有数据库未停止或替换。", file=__import__("sys").stderr)
        raise SystemExit(1)
