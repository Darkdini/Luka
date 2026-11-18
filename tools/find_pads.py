#!/usr/bin/env python3
"""Уточняет центры площадок на панораме города по цвету их светлой верхней грани.
Запуск: python3 tools/find_pads.py  → печатает JS-массив для shared/city.js и
сохраняет проверочную картинку с крестиками в scratch (путь аргументом)."""
import sys, json, subprocess
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

im = np.array(Image.open('client/assets/bg/town.jpg').convert('RGB')).astype(int)
pads = json.loads(subprocess.check_output(['node', '-e', "import('./shared/city.js').then(m=>console.log(JSON.stringify(m.PANO.pads)))"]))
mx, mn = im.max(2), im.min(2)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mask = (im.mean(2) >= 160) & (im.mean(2) <= 240) & (r - b >= 15) & (r - b <= 75) & (r >= g)
out, sizes = [], []
for (x, y) in pads:
    x0, y0 = max(0, x - 120), max(0, y - 75)
    win = mask[y0:y + 75, x0:x + 120]
    win = ndimage.binary_opening(win, iterations=2)
    lab, n = ndimage.label(win)
    best, bd = None, 1e9
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(xs) < 1500 or (xs.max() - xs.min()) > 200: continue
        cx, cy = xs.mean() + x0, ys.mean() + y0
        d = np.hypot(cx - x, cy - y)
        if d < bd: bd, best = d, (int(round((xs.min() + xs.max()) / 2 + x0)), int(round((ys.min() + ys.max()) / 2 + y0)), int(xs.max() - xs.min()))
    if best and bd < 60:
        out.append([best[0], best[1]]); sizes.append(best[2])
    else:
        out.append([x, y]); sizes.append(None)
print(json.dumps(out))
print('ширина верхней грани:', sizes)
if len(sys.argv) > 1:
    img = Image.open('client/assets/bg/town.jpg').convert('RGB'); d = ImageDraw.Draw(img)
    for (a, b), (x, y) in zip(pads, out):
        d.line([(a - 8, b), (a + 8, b)], fill=(255, 0, 0), width=3); d.line([(a, b - 8), (a, b + 8)], fill=(255, 0, 0), width=3)
        d.line([(x - 10, y), (x + 10, y)], fill=(0, 255, 255), width=3); d.line([(x, y - 10), (x, y + 10)], fill=(0, 255, 255), width=3)
    img.save(sys.argv[1])
