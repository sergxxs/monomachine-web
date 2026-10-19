# Проверка движков / Engine audit

Проверка: `node tests/engines_audit.js` — каждая машина реально триггерится в движке
(считаются запущенные осцилляторы/шумовые источники и FX-графы). Результат 2026-10-19: **ALL OK**.

## Оригинальная Monomachine (OS 1.32, 22 машины) — все на месте

| Группа | Машины у нас (имя на ЖК) | Статус |
|---|---|---|
| GND | GND-GND (тишина по дизайну), GND-SIN, GND-NOIS | ✅ |
| SID | SID-6581 — PW PWAD PWRS WAVE MOD MSRC MFRQ TUNE | ✅ |
| SuperWave | SWAVE-SAW, SWAVE-PULS, SWAVE-ENS | ✅ |
| DigiPRO | DPRO-WAVE, DPRO-BBOX (все 24 барабана звучат), DPRO-DDRW, DPRO-DENS | ✅ |
| FM+ | FM+STAT, FM+PAR, FM+DYN | ✅ |
| VO | VO-6 — VOC1 VOC2 V-SW VOIC CONS CLEN CVOL TUNE | ✅ |
| FX | FX-THRU, FX-REVERB (конвольвер), FX-CHORUS, FX-DYNAMIX (компрессор), FX-RINGMOD (несущий осц.), FX-PHASER (4 allpass), FX-FLANGER | ✅ обрабатывают NEIB/INP/BUS |

Имена машин и параметры страниц SYN совпадают с Appendix A мануала OS 1.32 один-в-один.

## MONO2K (github.com/InigoHernandez/mono2k, README) — все 9 на месте

| MONO2K | У нас | Источников при триге |
|---|---|---|
| GND-SIN | GND-SIN | 1 |
| GND-NOIS | GND-NOIS | 1 |
| SID-8BIT | SID-6581 | 4 |
| FM+STAT | FM+STAT | 3 |
| FM+DYN | FM+DYN | 3 |
| SWAV-SAW | SWAVE-SAW | 5 (база + юнисоны) |
| SWAV-ENS | SWAVE-ENS | 3 (2 пилы + хорус-LFO) |
| DIGI-WAV | DPRO-WAVE | 2 (морфинг двух волн) |
| VOX-6 | VO-6 | 2 (пульс + шум → форманты) |

Сверх MONO2K у нас есть ещё 13 оригинальных машин, которых в MONO2K пока нет:
GND-GND, SWAVE-PULS, DPRO-BBOX, DPRO-DDRW, DPRO-DENS, FM+PAR и все 7 FX.

## Что это значит честно

Машины воссозданы **clean-room на Web Audio** по мануалу и калибровкам MONO2K —
это не код Elektron (DSP56300) и не перекомпилированный C-код MONO2K.
Приближения: hard sync эмулируется FM, барабаны BBOX синтезированы (не ROM-сэмплы,
свои сэмплы грузятся), волны DigiPRO сгенерированы в том же 12-бит характере (не дамп ROM).

## Как проверить самому в приложении

POWER → клавиша **MACHINE** справа от ЖК: список всех 22 машин по группам.
Демо по семействам: A01 (SAW/DigiPRO/ENS/FM+BBOX+Reverb), A02 (SID), A03 (VO-6),
A05 (все FM+), A06 (DigiPRO wave-sequencing).
