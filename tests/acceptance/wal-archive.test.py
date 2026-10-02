import importlib.util
from pathlib import Path
import tempfile
import unittest

path = Path(__file__).resolve().parents[2] / "ops" / "wal_archive.py"
spec = importlib.util.spec_from_file_location("wal_archive", path)
wal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wal)


class ArchiveTest(unittest.TestCase):
    def test_copy_retry_collision_and_private_root(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            original = root / "原件"
            original.write_bytes(b"synthetic-WAL")
            store = root / "独立卷替身"
            store.mkdir(mode=0o700)
            wal.backup_root(str(store), synthetic=True)
            expected = wal.archive(original, "000000010000000000000001", store)
            self.assertEqual(wal.archive(original, "000000010000000000000001", store), expected)
            original.write_bytes(b"different")
            with self.assertRaises(ValueError):
                wal.archive(original, "000000010000000000000001", store)
            self.assertEqual((store / "wal" / "000000010000000000000001").read_bytes(), b"synthetic-WAL")
            with self.assertRaises(ValueError):
                wal.archive(original, "../outside", store)
            with self.assertRaises(FileNotFoundError):
                wal.backup_root(str(store))


if __name__ == "__main__":
    unittest.main()
