"""Génère les icônes PNG de l'extension (16, 32, 48, 128 px) sans dépendance externe.

Motif : disque indigo avec un symbole « passer au suivant » blanc (triangle + barre).
Usage : py tools/generate_icons.py

Principe :
  - le dessin est décrit par des formes géométriques dans un carré de côté 1
    (coordonnées de 0 à 1), ce qui permet de produire n'importe quelle taille ;
  - chaque pixel est découpé en SUPERSAMPLE x SUPERSAMPLE points d'échantillonnage :
    la proportion de points dans le disque donne la transparence, la proportion de
    points dans le symbole donne le mélange de couleurs. C'est un anticrénelage
    simple, qui adoucit les bords ;
  - le fichier PNG est écrit à la main (en-tête, blocs IHDR, IDAT et IEND), avec
    uniquement les modules standard struct et zlib.
"""
import os
import struct
import zlib

# Tailles demandées par Chrome : 16 (barre d'outils), 32 (écrans haute densité),
# 48 (page des extensions) et 128 (installation, Chrome Web Store).
SIZES = (16, 32, 48, 128)
# Nombre de points d'échantillonnage par pixel, dans chaque direction (4 x 4 = 16 points).
SUPERSAMPLE = 4
BACKGROUND = (57, 73, 171)  # indigo
GLYPH = (255, 255, 255)  # blanc
# Dossier de sortie : assets/icons/, à côté du dossier tools/.
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "icons")


def in_disc(x, y):
    """Vrai si le point (x, y) est dans le disque de fond (centre 0,5 ; rayon 0,47)."""
    return (x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.47 ** 2


def in_glyph(x, y):
    """Vrai si le point (x, y) appartient au symbole « passer au suivant »."""
    # Triangle pointant vers la droite : (0.30, 0.30) (0.30, 0.70) (0.60, 0.50).
    # Sa demi-hauteur diminue linéairement de 0,20 (à gauche) à 0 (à la pointe).
    if 0.30 <= x <= 0.60 and abs(y - 0.50) <= 0.20 * (0.60 - x) / 0.30:
        return True
    # Barre verticale à droite de la pointe.
    return 0.61 <= x <= 0.69 and 0.30 <= y <= 0.70


def render(size):
    """Calcule les pixels de l'icône et renvoie les lignes brutes au format PNG RGBA.

    Chaque ligne commence par un octet de filtre (0 = aucun filtre), suivi de 4 octets
    par pixel : rouge, vert, bleu, opacité.
    """
    rows = []
    n = SUPERSAMPLE
    for py in range(size):
        row = bytearray([0])  # filtre PNG « None »
        for px in range(size):
            # Compte les points d'échantillonnage du pixel qui tombent dans le disque,
            # et parmi eux ceux qui tombent dans le symbole.
            disc = glyph = 0
            for sy in range(n):
                for sx in range(n):
                    # Centre du point d'échantillonnage, ramené dans le carré de côté 1.
                    x = (px + (sx + 0.5) / n) / size
                    y = (py + (sy + 0.5) / n) / size
                    if in_disc(x, y):
                        disc += 1
                        if in_glyph(x, y):
                            glyph += 1
            total = n * n
            alpha = disc / total  # pixel partiellement couvert par le disque = semi-transparent
            if disc:
                # Mélange linéaire entre la couleur du fond et celle du symbole.
                mix = glyph / disc
                color = [round(b + (g - b) * mix) for b, g in zip(BACKGROUND, GLYPH)]
            else:
                color = [0, 0, 0]  # pixel hors du disque : entièrement transparent
            row += bytes(color + [round(alpha * 255)])
        rows.append(bytes(row))
    return b"".join(rows)


def png_chunk(kind, data):
    """Construit un bloc PNG : longueur, type (4 lettres), données, somme de contrôle CRC32."""
    chunk = kind + data
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)


def write_png(path, size):
    """Écrit l'icône de la taille donnée dans le fichier « path »."""
    # IHDR : largeur, hauteur, 8 bits par canal, type de couleur 6 (RGBA),
    # compression 0, filtre 0, pas d'entrelacement.
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8 bits, RGBA
    data = (
        b"\x89PNG\r\n\x1a\n"  # signature obligatoire de tout fichier PNG
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(render(size), 9))  # pixels compressés
        + png_chunk(b"IEND", b"")  # fin du fichier
    )
    with open(path, "wb") as f:
        f.write(data)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(path, size)
        print("écrit", os.path.normpath(path))
