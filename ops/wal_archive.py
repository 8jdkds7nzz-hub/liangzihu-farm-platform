#!/usr/bin/env python3
"""Durable, no-overwrite WAL copy. Runs as the PostgreSQL OS user."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for part in iter(lambda: f.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def backup_root(value=None, synthetic=False):
    root = Path(value or os.environ.get("WAL_ARCHIVE_ROOT", ""))
    if not root.is_absolute() or not root.is_dir() or root.is_symlink():
        raise ValueError("private backup volume not mounted")
    if root.stat().st_mode & 0o077:
        raise ValueError("backup root must be private (0700)")
    if not synthetic:
        marker = root / "独立备份卷核实.json"
        if marker.is_symlink():
            raise ValueError("invalid volume marker")
        config = json.loads(marker.read_text())
        if config.get("independentStorageVerified") is not True or not config.get("evidence") or config.get("clusterId") != os.environ.get("BACKUP_CLUSTER_ID"):
            raise ValueError("independent storage or dedicated cluster not verified")
    return root


def durable_copy(source, target):
    source, target = Path(source), Path(target)
    if source.is_symlink() or not source.is_file() or target.is_symlink() or target.parent.is_symlink():
        raise ValueError("symlinks and missing originals are rejected")
    expected = digest(source)
    if target.exists():
        if digest(target) != expected:
            raise ValueError("archive name collision; never overwrite")
        with open(target, "rb") as f:
            os.fsync(f.fileno())
        sync_directory(target.parent)
        return expected
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".归档中-", dir=target.parent)
        with os.fdopen(fd, "wb") as out, open(source, "rb") as original:
            for part in iter(lambda: original.read(1024 * 1024), b""):
                out.write(part)
            out.flush()
            os.fsync(out.fileno())
        if digest(temporary) != expected or digest(source) != expected:
            raise ValueError("copy checksum mismatch")
        try:
            os.link(temporary, target)
        except FileExistsError:
            if target.is_symlink() or digest(target) != expected:
                raise ValueError("concurrent archive collision")
        sync_directory(target.parent)
        return expected
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def archive(source, name, root):
    if not re.fullmatch(r"[A-Za-z0-9.]{1,64}", name) or name in (".", ".."):
        raise ValueError("invalid WAL name")
    wal = root / "wal"
    if wal.is_symlink():
        raise ValueError("invalid WAL directory")
    wal.mkdir(mode=0o700, exist_ok=True)
    sha = durable_copy(source, wal / name)
    sidecar = wal / (name + ".sha256")
    if sidecar.is_symlink():
        raise ValueError("invalid checksum file")
    try:
        with open(sidecar, "x", opener=lambda p, f: os.open(p, f, 0o600)) as f:
            f.write(sha + "\n")
            f.flush()
            os.fsync(f.fileno())
    except FileExistsError:
        if sidecar.read_text().strip() != sha:
            raise ValueError("checksum collision")
    sync_directory(wal)
    return sha


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("name")
    args = parser.parse_args()
    archive(args.source, args.name, backup_root())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("WAL归档失败；原文件未被覆盖，请检查私有备份卷、空间和校验。", file=__import__("sys").stderr)
        raise SystemExit(1)
