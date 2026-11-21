# Kura Fast CSV — Read broken CSV files faster

Pelan-pelan, satu lompatan, sampai garis finis. Entri ini adalah drop-in yang lebih cepat untuk csv-reader 1.0.0: menjawab **persis sama** di setiap kasus — `{columns, rows, errors}` yang identik — tapi membaca dengan lompatan `indexOf` ke karakter spesial berikutnya dan `slice` satu field utuh sekaligus, bukan satu karakter demi satu karakter.

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/srimuryaticitra-cpu/csv-reader-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/srimuryaticitra-cpu/csv-reader-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

## Cara kerja

- **Field polos** (kasus umum): tiga `indexOf` native — koma, LF, CR — lalu satu `slice`. Tanpa alokasi, tanpa join, tanpa closure per field.
- **Field ber-quote**: lompat ke `"` berikutnya; `""` jadi satu `"`, CRLF/CR di dalam quote dibaca sebagai LF dan dihitung barisnya.
- **Baris rusak, persis seperti csv-reader**: `stray_cr` (CR di luar quote yang tidak diikuti LF dibuang), `quote_junk` (karakter setelah closing quote ditempel apa adanya), `unterminated_quote` (quote yang tak tertutup jadi literal, sisanya dibaca ulang sebagai unquoted), `short_row`/`long_row` (dipad `""` atau dipotong ke lebar record pertama), plus nomor `line`/`row` error yang sama.
- **Deterministik**: tanpa jam, tanpa acak, tanpa state antar kasus — dua kali jalan menghasilkan byte yang sama persis.

## File

- `solve.js` — ES module, `run(input)` mengembalikan `{columns, rows, errors}`.
- `main.ts` — driver harness: baca `/input/cases.json`, jawab tiap kasus dengan `run`, tulis `/output/answers.json`. Mematikan V8 incremental marking seperti baseline.

## Lisensi

MIT — lihat `LICENSE`.
