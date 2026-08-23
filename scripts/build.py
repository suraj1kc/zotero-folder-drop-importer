from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADDON = ROOT / "addon"
SRC = ROOT / "src"
DIST = ROOT / "dist"

manifest = json.loads((ADDON / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
name = f"Zotero-Folder-Drop-Importer-{version}.xpi"
out = DIST / name

DIST.mkdir(exist_ok=True)
if out.exists():
    out.unlink()

with tempfile.TemporaryDirectory() as tmpdir:
    stage = Path(tmpdir)
    for path in ADDON.rglob("*"):
        if path.is_file():
            target = stage / path.relative_to(ADDON)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)

    target_src = stage / "src"
    target_src.mkdir(parents=True, exist_ok=True)
    for path in SRC.rglob("*"):
        if path.is_file():
            target = target_src / path.relative_to(SRC)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(stage).as_posix())

print(out)
