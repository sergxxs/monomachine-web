# MONOMACHINE SFX-60+ Web — браузерная Monomachine для iPhone

Clean-room воссоздание **Elektron Monomachine SFX-60+ MKII (OS 1.32)** на Web Audio:
все **22 машины**, 6 моно-треков, страницы SYN/AMP/FILT/EFX + 3 LFO, 64-шаговый
секвенсор с **parameter locks**, арпеджиаторы, соседний FX-роутинг — и панель,
повторяющая оригинальный SFX-60 MkI: чёрная матовая вставка с ЖК и ручками 2×4,
кремовые клавиши TRACK, FUNCTION с коричневыми подписями. Включение клавишей **POWER** показывает
короткий LCD pixel-test/логотип на настоящем пиксельном ЖК 128×64 (1-бит, шрифт 3×5), затем открывается главный экран.
LCD попапы и переключение DATA PAGE анимированы короткими железячными wipe/expand, а панель имеет лёгкую матовую 3D-глубину без «глянцевого» редизайна.
Для iPhone есть отдельные портретная и ландшафтная раскладки: панель не уменьшается целиком в микроскоп,
кнопки, подписи и светодиоды разнесены под палец (PWA, иконка на «Домой»). Движки и калибровка — по мотивам открытого проекта
[MONO2K](https://github.com/InigoHernandez/mono2k) (Sequencist), сверено с мануалом OS 1.32.
**Ни кода, ни сэмплов, ни прошивки Elektron внутри нет.** Не аффилировано с Elektron.

## Как пользоваться

- **Live Preview** (кнопка в интерфейсе Arena) — сразу играбельно.
- **`../monomachine-iphone.html`** — один самодостаточный файл: сохраните в
  «Файлы» на iPhone или откройте с любого хостинга. Работает офлайн.
- На iPhone: **Поделиться → На экран «Домой»** — встанет как приложение.
  Работают и портрет, и ландшафт. Сначала клавиша **POWER** вверху справа (требование iOS);
  **▶ PLAY** тоже умеет включить питание и сразу стартовать. Сверху слева — **REC WAV**:
  записывает мастер до повторного нажатия или **STOP**, затем сохраняет настоящий стерео-WAV.
- Локально: `python3 -m http.server 8723 --directory .` и открыть `index.html`.

## Управление = железка

| На SFX-60+ | Здесь |
|---|---|
| DATA ENTRY A–H | 8 ручек: тянуть вверх/вниз; двойной тап — сброс; колесо мыши на десктопе |
| DATA PAGE (7 страниц) | Список справа от ЖК: SYNTHESIS…LFO 3, клавиши вверх/вниз + тап по строке (ARP — клавишей ARP) |
| Удержать TRIG + крутить ручку | **Удержание триг-клавиши → P-LOCK EDIT**: ручки пишут локи в шаг, LCD инвертирует параметры, как на оригинале |
| GRID / LIVE RECORDING | Кнопка REC циклирует GRID → LIVE → KEYS (триги = клавиши) |
| TRIG keys, SCALE, TEMPO, LEVEL | Те же места на панели; **TEMPO − / TAP / +** меняет BPM на 0.1 сразу (удержание ± ускоряется), пока TEMPO-popup открыт ручка LEVEL тоже крутит BPM; SCALE — длина 16/32/48/64, скорость 3/4–2X, свинг |
| KIT EDIT (выбор машины) | Клавиша MACHINE (EDIT) справа от ЖК |
| FUNCTION + клавиша | Коричневые подписи: COPY/CLEAR/PASTE (REC/PLAY/STOP), GLOBAL, POLY, MUTE MODE (BANK), MIDI SEQ (TRIG SELECT), FUNCTION+TRACK = мьют. FUNCTION удерживается вторым пальцем или защёлкивается тапом на одно нажатие |
| Двойной тап по тригу | Редактор шага: нота, LEN, слайд, вероятность, ратчет, микротайминг, ARP-ноты, список локов |

## Машины (22 — все, как в OS 1.32)

- **GND**: GND (тишина), GND-SIN, GND-NOIS
- **SID-6581**: PW/PWAD/PWRS, WAVE TRI/SAW/PULS/MIX/NOIS, RING/SYNC, MSRC=MFRQ/PRCH
- **SuperWave**: SWAVE-SAW (UNIL/UNIW/UNIX/SUBX/SUB1/SUB2), SWAVE-PULS (настоящий PWM), SWAVE-ENS (аккорды PCH2–4, ансамблевый хорус)
- **DigiPRO**: DPRO-WAVE (32 волны 12-бит + морфинг WP/WPM), DPRO-BBOX (24 синтезированных барабана + свои сэмплы, RTRG/RTIM), DPRO-DDRW (две волны, MIX/WID/BR1/BR2), DPRO-DENS
- **FM+**: FM+STAT, FM+PAR, FM+DYN
- **VO-6**: формантный голос — VOC1/VOC2, согласные CONS/CLEN/CVOL, шёпот VOIC (паттерн A03 «разговаривает»)
- **FX** (обрабатывают NEIB/INP/BUS, триги гейтят сигнал): THRU, REVERB, CHORUS, DYNAMIX, RINGMOD, PHASER, FLANGER

Тракт трека как на железке: DIST (биполярный: ниже 64 тише) → SRR (AudioWorklet
sample&hold; фолбэк — квантизатор) → фильтр BASE/WDTH (HP 12 дБ + LP 24 дБ) с
огибающей BOFS/WOFS → EQ → AMP-огибающая (законы времён из калибровки MONO2K:
атака 0.9 мс·e^(0.0814v), hold 14.6 мс/шаг) → PAN → ленточный дилэй трека с
фильтрованным фидбэком. 3 темпо-LFO на трек (11 волн, 5 триг-режимов, INTL interlace,
назначение — любой параметр + PTCH).

## Секвенсор и данные

128 паттернов (A01–H16), киты, SONG, CHAIN, очередь паттернов при игре,
copy/paste/clear, транспозиция, евклидов генератор, POLY-режим для клавиш,
автосейв в localStorage («+Drive»). Фабрика A01–A08: SIGNAL, SIDRAIN, VOXMACH,
DUBPLATE, FMFOUNDRY, WAVESEQ, MINIMAL, AMBIENT.

Файлы (FILE / +DRIVE): проект **JSON**, паттерн → **MIDI** (p-locks — оригинальными
CC: SYN 48–55, AMP 56–63, FILT 72–79, EFX 80–87, LFO 88–119, LEVEL CC7),
запись мастера кнопкой **REC WAV** в настоящий WAV, WAV-волны и рисование волн пальцем (DigiBank D33–D64
для DDRW/DENS), сэмплы для BBOX. Web MIDI: каналы 1–6 = треки (Chrome desktop; в iOS Safari Web MIDI нет).

STOP и MUTE трека работают как panic-flush: отменяют уже запланированные огибающие и глушат delay/reverb/FX-хвосты,
поэтому после остановки не остаётся самовозбуждающийся шум. UI/LCD перерисовываются по изменениям, а не каждый кадр;
во время игры лёгкий playhead обновляет только текущую ячейку.

## Настоящий Monomachine SysEx, import kits и random kit

В **KITS → IMPORT KIT .SYX** или **FILE → IMPORT .SYX/.MID** можно загрузить dump с настоящей Monomachine или
custom .syx (raw, несколько сообщений в файле, а также SysEx внутри Standard MIDI File):

- **KIT DUMP 0x52** → LOAD NOW / ADD TO BANK / LOAD + SAVE: реальные model ID, уровни, SYN/AMP/FILT/EFX/LFO,
  FX-routing и hardware ASSIGN/keytrack metadata для обратного экспорта;
- **PATTERN DUMP 0x67** → trigs, notes, slides, off-trig длины, аккорды, swing, длина, transpose/ARP flags,
  p-locks и отдельные filter/LFO/**trigless** trigs; связанный kit из того же файла можно применить вместе с паттерном;
- **DIGIPRO WAVE 0x5D** → основная 1024-семпловая волна декодируется в DigiBank (важно: это не kit/pattern RLE-формат);
- global/song/custom SysEx сохраняются байт-в-байт в **SysEx Library (IndexedDB)**, скачиваются обратно и на десктопе
  отправляются через Web MIDI; дампы с битой checksum по умолчанию отклоняются, есть явный FORCE DECODE;
- **CURRENT KIT .SYX** и **ALL KITS .SYX** экспортируют киты обратно в железном 0x52-формате.

В **KITS → RANDOMIZE** есть `RANDOMIZE KIT` на все 6 треков (темы ACID, FM LAB, CHIP, DIGI, DUB, INDUSTRIAL, VOX,
MINIMAL), отдельный random sound текущего трека и RND по каждому треку. Scope: SYN / SOUND / ALL (+LFO/ARP);
Amount: MUTATE / RANDOM / CHAOS. Генератор ограничивает уровни, фильтр, feedback и release, поэтому рандом обычно
сразу звучит, а не уходит в тишину/самовозбуждение; результат сохраняется в банк, работает **UNDO KIT**.

## Честно про «прошивку от Elektron» и «1-к-1»

Оригинальная ОС Monomachine — машинный код **ColdFire + двух Motorola DSP56300**.
Исполнить её бит-в-бит в мобильном Safari нельзя: нужен JIT-эмулятор DSP56300 и
эмуляция периферии, а iOS запрещает сторонние JIT. Поэтому — как и сам MONO2K —
здесь машины воссозданы clean-room по мануалу и измерениям, а не запущен бинарь ОС.

Что реально умеет **Firmware Lab** с пользовательским оригинальным OS **.SYX/.BIN/.IMG**:

- принимает и не изменяет файл, сохраняет его локально в Firmware Vault (IndexedDB, dedupe по SHA-256);
- считает SHA-256/CRC32, показывает энтропию, SysEx-контейнер, ASCII-маркеры/версию и hex head/tail;
- отличает OS/upgrade package от kit/pattern dump; dumps из Lab можно сразу открыть настоящим SysEx-импортом;
- **BOOT TEST** честно останавливается на отсутствующем Safari/WASM core ColdFire + 2×DSP56300. Это слот вставки и
  диагностики вашего OS-файла, а не фейковый запуск и не поставка прошивки Elektron внутри приложения.

Если нужен побитный звук вашей ОС на компьютере — это делают
[Monomodule](https://monomodule.com/) и gearmulator-md-mm: они грузят OS-файл и
исполняют DSP-программу инструкция-в-инструкцию; Monomodule Library также
lossless-читает SysEx-киты/паттерны. Сюда такой движок физически не влезет.

## Структура и тесты

```
index.html style.css manifest.webmanifest
js/state.js  — машины/параметры (реальные SysEx model ID), фабричные паттерны и киты, снапшот
js/sysex.js  — clean-room Elektron 7-bit/RLE codec, KIT 0x52, PATTERN 0x67, DigiPRO 0x5D, SMF SysEx
js/audio.js  — WebAudio: голоса машин, тракт, FX, LFO, секвенсор, trigless locks
js/ui.js     — панель, ручки, LCD-анимации, TEMPO, листы, KITS randomizer, SysEx Library, Firmware Lab, MIDI
build_single.py — сборка ../monomachine-iphone.html
tests/smoke.js      — модель данных + фабрика (node tests/smoke.js)
tests/audio_smoke.js— фейковый WebAudio: все 22 машины + секвенсор (+ WORKLET=1)
tests/sysex_smoke.js— kit round-trip, pattern/trigless/p-locks, DigiPRO, SMF, повреждённая checksum
```

## Известные приближения

Хард-синк в DPRO-WAVE/SID SYNC эмулируется FM-окраской (в Web Audio нет hard sync);
BBOX барабаны синтезированы, а не оригинальные 12-бит сэмплы (свои можно загрузить);
волны DPRO сгенерированы в том же характере, а не считаны из ROM; MULTI-режим
MIDI-секвенсора наружу заменён MIDI-out нотами треков. Характер, параметры и
воркфлоу — как на железке; побайтной идентичности DSP не обещаю — её даёт только
эмулятор DSP56300 с вашей ОС (см. выше).
