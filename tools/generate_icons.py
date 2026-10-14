"""Génère les icônes PNG de l'extension (16, 32, 48, 128 px) sans dépendance externe.

Motif : disque indigo avec un symbole « passer au suivant » blanc (triangle + barre).
Usage : py tools/generate_icons.py
"""
import os
import struct
import zlib

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4
BACKGROUND = (57, 73, 171)  # indigo
GLYPH = (255, 255, 255)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "icons")


def in_disc(x, y):
    return (x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.47 ** 2


def in_glyph(x, y):
    # Triangle pointant vers la droite : (0.30, 0.30) (0.30, 0.70) (0.60, 0.50)
    if 0.30 <= x <= 0.60 and abs(y - 0.50) <= 0.20 * (0.60 - x) / 0.30:
        return True
    # Barre verticale
    return 0.61 <= x <= 0.69 and 0.30 <= y <= 0.70


def render(size):
    rows = []
    n = SUPERSAMPLE
    for py in range(size):
        row = bytearray([0])  # filtre PNG « None »
        for px in range(size):
            disc = glyph = 0
            for sy in range(n):
                for sx in range(n):
                    x = (px + (sx + 0.5) / n) / size
                    y = (py + (sy + 0.5) / n) / size
                    if in_disc(x, y):
                        disc += 1
                        if in_glyph(x, y):
                            glyph += 1
            total = n * n
            alpha = disc / total
            if disc:
                mix = glyph / disc
                color = [round(b + (g - b) * mix) for b, g in zip(BACKGROUND, GLYPH)]
            else:
                color = [0, 0, 0]
            row += bytes(color + [round(alpha * 255)])
        rows.append(bytes(row))
    return b"".join(rows)


def png_chunk(kind, data):
    chunk = kind + data
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)


def write_png(path, size):
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8 bits, RGBA
    data = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(render(size), 9))
        + png_chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(data)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(path, size)
        print("écrit", os.path.normpath(path))
