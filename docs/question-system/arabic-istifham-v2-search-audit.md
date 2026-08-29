# Arabic Istifham V2 — Search Audit

- Review endpoint: http://127.0.0.1:3000
- Bank node: 0195a100-0011-7000-8000-000000000011
- Search API was exercised after publication and explicit projection rebuild.

| # | Query | Normalized query | Result count | Status |
|---:|---|---|---:|---:|
| 1 | هناك حرف محذوف | هناك حرف محذوف | 1 | 200 |
| 2 | قال الشاعر | قال الشاعر | 227 | 200 |
| 3 | طَرِبتُ | طربت | 2 | 200 |
| 4 | طربت | طربت | 2 | 200 |
| 5 | أين | اين | 33 | 200 |
| 6 | اين | اين | 33 | 200 |
| 7 | إعراب | اعراب | 171 | 200 |
| 8 | اعراب | اعراب | 171 | 200 |
| 9 | إستفهام | استفهام | 351 | 200 |
| 10 | استفهام | استفهام | 351 | 200 |
| 11 | الحرف المحذوف | الحرف المحذوف | 3 | 200 |
| 12 | 2014 | 2014 | 27 | 200 |
| 13 | د1 | د1 | 168 | 200 |
| 14 | وزاري | وزاري | 375 | 200 |
| 15 | السما | السما | 11 | 200 |
| 16 | وأصحاب | واصحاب | 2 | 200 |
| 17 | اصحاب | اصحاب | 2 | 200 |
| 18 | معايبه | معايبه | 1 | 200 |
| 19 | همزة الاستفهام | همزة الاستفهام | 10 | 200 |
| 20 | قال تعالى | قال تعالى | 153 | 200 |

- Diacritic and non-diacritic pairs tested: طَرِبتُ/طربت, أين/اين, إعراب/اعراب, إستفهام/استفهام, وأصحاب/اصحاب.
- Underline target tested: معايبه.
- Poetry, Quran, Answer, and provenance/year segments were queried without changing the M15 normalizer.
