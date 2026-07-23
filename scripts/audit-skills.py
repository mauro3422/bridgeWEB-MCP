"""Compatibility entrypoint for the MSSR-owned skill audit."""

from pathlib import Path
import runpy

MSSR_AUDIT = Path(__file__).resolve().parents[2] / "mssr" / "scripts" / "audit-skills.py"
if not MSSR_AUDIT.exists():
    raise SystemExit(f"MSSR audit script not found: {MSSR_AUDIT}")
runpy.run_path(str(MSSR_AUDIT), run_name="__main__")
