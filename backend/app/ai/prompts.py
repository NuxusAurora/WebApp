from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "prompts" / "gateway"


def prompt(name: str) -> str:
    if name not in {"probe", "structured", "repair"}:
        raise ValueError("Unknown gateway prompt")
    return (ROOT / f"{name}.md").read_text(encoding="utf-8")
