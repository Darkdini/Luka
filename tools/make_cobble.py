#!/usr/bin/env python3
"""Бесшовная брусчатка для улиц города из пола арены (зеркальная склейка 2×2)."""
import json, os
from PIL import Image, ImageEnhance, ImageOps
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
im = Image.open(os.path.join(ROOT, 'art/source/realm/arenas_tower.png')).convert('RGB')
c = im.crop((418 + 100, 400, 418 + 360, 660))
c = ImageEnhance.Color(c).enhance(0.75)
c = ImageEnhance.Brightness(c).enhance(1.08)
w, h = c.size
t = Image.new('RGB', (w * 2, h * 2))
t.paste(c, (0, 0)); t.paste(ImageOps.mirror(c), (w, 0)); t.paste(ImageOps.flip(c), (0, h)); t.paste(ImageOps.flip(ImageOps.mirror(c)), (w, h))
t = t.resize((256, 256), Image.LANCZOS)
out = os.path.join(ROOT, 'client/assets/realm/city/tex_cobble.jpg')
t.save(out, quality=88)
mp = os.path.join(ROOT, 'client/assets/realm/city/manifest.json')
m = json.load(open(mp)); m['tex_cobble'] = {'w': 256, 'h': 256}; json.dump(m, open(mp, 'w'), ensure_ascii=False, indent=0)
print('ok', out)
