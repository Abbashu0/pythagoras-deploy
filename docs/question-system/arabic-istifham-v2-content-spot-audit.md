# Arabic Istifham V2 — Content Spot Audit

- Review endpoint: http://127.0.0.1:3000
- Records checked: 20
- Suspicious classifications: 1
- This report is read-only and does not alter package or canonical data.

## Required Samples

| Order | Question preserved | Answer preserved | Poetry | Quran | Lists | Underlines | Provenance visible | Suspicious |
|---:|:---:|:---:|:---:|:---:|:---:|---:|:---:|---|
| 1 | yes | yes | yes | n/a | yes | 0 → 0 | no | none |
| 2 | yes | yes | yes | n/a | yes | 0 → 0 | no | none |
| 3 | yes | yes | yes | n/a | n/a | 0 → 0 | no | none |
| 4 | yes | yes | yes | yes | yes | 0 → 0 | no | none |
| 5 | yes | yes | yes | n/a | n/a | 0 → 0 | no | none |
| 6 | yes | yes | n/a | n/a | yes | 2 → 2 | no | none |
| 7 | yes | yes | yes | n/a | yes | 0 → 0 | no | none |
| 8 | yes | yes | yes | n/a | yes | 1 → 1 | no | none |
| 9 | yes | yes | n/a | yes | yes | 0 → 0 | no | none |
| 10 | yes | yes | n/a | yes | n/a | 0 → 0 | no | none |
| 12 | yes | yes | yes | n/a | n/a | 0 → 0 | no | none |
| 13 | yes | yes | n/a | yes | n/a | 0 → 0 | no | none |
| 18 | yes | yes | n/a | yes | yes | 0 → 0 | no | none |
| 35 | yes | yes | yes | n/a | n/a | 0 → 0 | no | none |
| 40 | yes | yes | yes | n/a | n/a | 0 → 0 | no | none |
| 68 | yes | yes | yes | n/a | n/a | 0 → 0 | no | none |
| 91 | yes | yes | n/a | n/a | n/a | 0 → 0 | no | none |
| 94 | yes | yes | no | n/a | yes | 1 → 1 | no | expected poetry block missing |
| 101 | yes | yes | n/a | n/a | n/a | 1 → 1 | no | none |
| 113 | yes | yes | yes | n/a | yes | 1 → 1 | no | none |

- Poetry sample orders: 1, 2, 3, 4, 5
- Quran sample orders: 4, 9, 10, 13, 18
- Ordered multi-demand sample orders: 1, 2, 4, 6, 7
- Underline sample orders: 6, 8, 94, 101, 113
- Explicit source-reference orders: 35, 40, 68

## Q40 Assertion

- Question contains (2014 د1 أدبي): false
- Question contains (2015 د1 أدبي): false
- Answer contains a source-year annotation: false
- Structured occurrences: 2014 د1 أدبي; 2015 د1 أدبي
- Old inherited 2014 تمهيدي علمي retained: false
- Decision: the inherited occurrence is replaced because the explicit source annotations in the Question are the more specific source-of-truth for this record; it is not retained as an extra occurrence.

## Notes

- Quran conversion was limited to strong `قال تعالى: ﴿...﴾` evidence; no verse numbers were invented.
- Poetry conversion was limited to clear `قال الشاعر` lead-ins with a reliable hemistich separator; ambiguous records remain flagged in the package audit.
- No answer, Question, or occurrence was merged by this audit.
