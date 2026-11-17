# Промты для графики

Исходники лежат в `art/source/`. Нарезку на спрайты делает `npm run assets` (`tools/slice_sheets.py`), результат пишется в `client/assets/`.

**Общий хвост для всех листов:**

```
chunky stylized 3D cartoon render, bold exaggerated proportions, bright saturated colors, soft global illumination, medieval fantasy, mobile strategy game asset, isometric 3/4 top-down view, evenly spaced grid, items separated by empty space, no overlapping, solid flat light grey background, consistent style
```

Правила для нарезки: однотонный фон (светло-серый или тёмно-серый, без «шахматки»), не больше 4×4 элементов на лист, максимальное разрешение.

## ✅ Готово

| Файл | Что внутри |
|---|---|
| castle_sheet.png | Цитадель, 6 уровней |
| economy_sheet.png | Рудник, мельница, казна, амбар (по 3 уровня) |
| defense_sheet.png | Башня лучников, баллиста, требушет, башня магов (по 3 уровня) |
| walls_sheet.png | Стены 4 тиров (прямая и угол), ловушки, руины |
| military_sheet.png | Казармы, алтарь, хижина строителя, кузница, башня алхимика, гильдия, мастерская, таверна |
| troops_sheet.png | 9 видов войск |
| heroes_sheet.png | 4 героя: в полный рост и портреты |
| spells_sheet.png | Иконки и эффекты заклинаний |
| decor_sheet.png | Деревья, камни, декор |
| pads_sheet.png | Фундаменты и дорожки |
| ui_kit.png | Элементы интерфейса |
| base_bg.png, world_map.png, loading_battle.png, grass.png | Фоны |
| army_camp.gif | Военный лагерь |

## 🎨 Нужно сгенерировать (по приоритету)

### 0а. Тайлы карты мира (4×4) — сейчас рисуются кодом
```
Sprite sheet grid 4x4, isometric diamond-shaped (2:1) world map terrain tiles, top-down 3/4 view, seamless edges: lush grass, flower meadow, light forest, dense pine forest, rocky hills, tall snowy mountain, snow field, snowy pines, lake water, river straight, sandy desert, desert dunes, swamp, farmland fields, cobblestone road straight, road crossing
```

### 0б. Объекты карты мира (4×2)
```
Sprite sheet grid 4x2, isometric fantasy world map points of interest: bandit camp with tents and palisade, monster lair cave entrance, ancient ruins with glowing runes, gold vein in rocks, blue crystal deposit, haunted graveyard, dark necromancer fortress with purple fire, glowing magic portal
```

### 0в. Сюжетные портреты (3×2) — сейчас заглушки из войск с фильтрами
```
Portrait sheet grid 3x2, fantasy character bust portraits, dramatic rim lighting, chunky stylized painted style: Morvain the dark lord necromancer with cracked iron crown and purple fire eyes; bandit chieftain "Crooked Fang" with scarred face; ghost of old King Aurel, translucent blue, sad and noble; young heir lord in simple blue cloak; young heir lady in simple blue cloak; Isolde the sorceress corrupted by dark magic, purple veins
```

### 0г. Лиги и медали (4×3)
```
Icon sheet grid 4x3, glossy fantasy game badges: row 1 league shields bronze, silver, gold, platinum; row 2 diamond league shield, legend league shield with crown, bronze medal, silver medal; row 3 gold medal, crossed swords medal, castle tower medal, treasure chest medal
```

### 0д. Фоны сюжетных сцен (по одной, --ar 16:9)
```
Painted fantasy scene, chunky stylized: (a) burning frontier village at night, (b) ruined royal throne room with shattered crown on the floor, (c) dark necromancer citadel under a purple storm sky
```

### 1. Уровни 2–3 для армейских зданий (3×3)
Сейчас у казарм, кузницы, алтаря и башни алхимика один вид на все уровни.
```
Sprite sheet grid 3x3, isometric medieval buildings, three upgrade levels per row (small wooden, stone with banners, grand stone and gold): row 1 barracks with training dummies, row 2 blacksmith forge, row 3 alchemist spell tower with glowing potions
```

### 2. Расы: гербы и воины (4×2), для экрана регистрации
```
Character sheet grid 4x2, top row heraldic shields, bottom row full-body warrior: humans (blue and gold lion), elves (green and silver leaf), dwarves (bronze and red hammer), orcs (crimson and black skull)
```

### 3. Войска других рас (по листу 3×3 на расу)
Сейчас у всех рас «синие» войска. Тот же список, что у людей:
```
Character sprite sheet grid 3x3, chunky stylized 3D cartoon {RACE} army units, full body, facing bottom-right, action pose, {COLORS} heraldry: swordsman, crossbowman, heavy shield bearer, thief with loot sack, sapper with powder keg, battle mage, priest healer, battering ram with crew, {ELITE_FLYER}
```
- elves: green and silver, giant eagle rider
- dwarves: bronze and red, gyrocopter pilot
- orcs: crimson and black, wyvern rider

### 4. Зимняя версия базы (сезонный ивент и платная косметика)
```
Isometric 3/4 top-down view, large empty flat diamond-shaped snowy plateau for a medieval town, surrounded by snowy mountains and frozen cliffs, snowy pine forest, frozen river with a stone bridge, icy coastline with a wooden pier; central diamond area completely empty flat snow, no buildings, chunky stylized hand-painted game background --ar 16:10
```

### 5. Скелеты для заклинания призыва (2×2)
```
Character sprite sheet grid 2x2, chunky stylized skeleton warriors with rusty swords and shields, glowing blue eyes, facing bottom-right, action pose
```
