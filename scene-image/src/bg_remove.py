"""Remove portrait backgrounds so PNG cutouts overlay cleanly on scene art.

Prefers rembg when installed; falls back to near-white chroma key via Pillow.
"""

from __future__ import annotations

from pathlib import Path


def remove_background(image_path: str | Path, *, threshold: int = 245) -> Path:
    """In-place: rewrite image_path as RGBA PNG with transparent background."""
    path = Path(image_path)
    if not path.is_file():
        raise FileNotFoundError(path)

    try:
        return _remove_with_rembg(path)
    except Exception:
        return _remove_near_white(path, threshold=threshold)


def _remove_with_rembg(path: Path) -> Path:
    from rembg import remove  # type: ignore
    from PIL import Image
    import io

    raw = path.read_bytes()
    cut = remove(raw)
    im = Image.open(io.BytesIO(cut)).convert("RGBA")
    im.save(path, format="PNG")
    return path


def _remove_near_white(path: Path, *, threshold: int = 245) -> Path:
    """Treat near-white pixels as background — good enough for solid white gens."""
    from PIL import Image

    im = Image.open(path).convert("RGBA")
    pixels = im.load()
    w, h = im.size
    soft = max(8, min(40, 255 - threshold + 8))

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            mx = max(r, g, b)
            mn = min(r, g, b)
            # Keep saturated / darker pixels (character art).
            if mn < threshold or (mx - mn) > soft:
                continue
            # Pure white → alpha 0; near-threshold → soft edge.
            t = (mn - threshold) / max(1, 255 - threshold)
            alpha = max(0, min(255, int(a * (1.0 - t))))
            pixels[x, y] = (r, g, b, alpha)

    im.save(path, format="PNG")
    return path
