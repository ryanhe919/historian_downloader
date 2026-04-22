from pathlib import Path


def test_pyinstaller_spec_includes_win32timezone_hidden_import():
    spec_path = Path(__file__).resolve().parents[1] / "build" / "hd-sidecar.spec"
    text = spec_path.read_text(encoding="utf-8")

    assert '"win32timezone"' in text
