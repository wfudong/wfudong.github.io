# Calculus I Grade Publishing

The student page is `teaching-site/calculus-1-grades.html` (add `?lang=zh` for Chinese).
It shows quizzes, midterm, homework, and final exam scores. Readable student data
and access codes must stay outside this repository; only encrypted records are published.

## First Setup

Use Node.js 22 or later. No packages or online services are required. Run from
the `wfudong.github.io` repository:

```sh
node tools/publish-grades.mjs init
```

This creates `../private-grades/calculus-1/gradebook.json`, outside the public
website repository. Both the website and the surrounding workspace Git ignore
private grade files. Do not move them into the website or force-add them to Git.

Edit the private gradebook. Here is a **fictional format example**, not an
official score or grading scheme:

```json
{
  "students": [
    {
      "student_id": "DEMO001",
      "name": "Fictional Student",
      "grades": {
        "quiz": [
          {"label": "Quiz 1", "score": 8, "max_score": 10}
        ],
        "midterm": [
          {"label": "Midterm", "score": null, "max_score": 100}
        ],
        "homework": [
          {"label": "Homework 1", "score": 18, "max_score": 20, "comment": "Student-visible feedback"}
        ],
        "final": []
      }
    }
  ]
}
```

All four category arrays are required. Use `null` for an unrecorded score and
`[]` if no assessment has been added. `name` may be an empty string. IDs must be
unique and contain only letters, digits, underscores, and hyphens, starting with
a letter or digit. Scores may be nonnegative numbers or short letter/status
marks such as `P`, preserved without interpreting their meaning. Maximum scores
must be positive numbers or `null` if unspecified; letter marks require `null`.
Never assume that the highest observed score is the official maximum.
Comments are **visible to the student**. No weighted total
is inferred. Each student's record has a 16 KiB size limit.

## Import an Excel Gradebook

The local importer requires Python 3.9+ and `openpyxl`. It reads sheets with
`学号` and `姓名` headers in row 1, plus `Quiz1`, `Quiz2`, `HW1`, `HW2`, etc.
Every student ID must be stored as Excel text, preserving leading zeros.

```sh
python3 tools/import-grades.py import /path/to/grades.xlsx
node tools/publish-grades.mjs publish
python3 tools/import-grades.py codes
```

This prepares encrypted output locally; these commands do not upload it. The
original workbook is not changed. `P` remains `P`, blanks remain unrecorded,
and maximum scores are unspecified by default. Only if officially confirmed,
pass `--quiz-max 10` (or the correct maximum) to the import command. Entirely
blank assessment columns are retained as unrecorded results, not zero scores.

Imports merge by student ID and assessment label. Existing midterm/final results,
feedback, confirmed numeric maxima, and students not present in the workbook
are preserved. Remove an old student explicitly from the private gradebook if
needed. Private gradebook backups are created before each update.

After encryption, `codes` produces the confidential
`../private-grades/calculus-1/student-access-codes.xlsx`, with group, student ID,
name, individual code, and the grade-page URL. It excludes the demo account.
**Do not send the whole workbook to students.** Share only each student's own
code. Private `import-roster.json` and `import-report.json` contain group mapping
and coordinates of blank cells for local review; none belong in Git.

## Publish and Update

```sh
node tools/publish-grades.mjs publish
```

This generates:

- **Public:** `teaching-site/grades-data/calculus-1/<opaque-hash>.json` containing
  only encrypted records, one per student.
- **Private:** `../private-grades/calculus-1/access-codes.json` and
  `access-codes.csv`, mapping student IDs to their individual codes.

Give each student only their own code, privately, through the university LMS
or another trusted channel. Never distribute the whole CSV, store a code in a
URL, or replace generated codes with short passwords or student IDs.

Back up the private gradebook and code files to storage you control. A normal
update preserves the same code for each unchanged student ID. Change scores in
the private gradebook, run `publish` again, review the Git changes, and commit
and push the encrypted output to update the website. The export command does
not push automatically. On a partial filesystem failure, rerun the export
successfully before committing; do not publish partially prepared output.

The browser fetches a fresh encrypted record for each unlock. An open record
shows the last published time; lock and reopen it after a new deployment.
Until the first export and deployment, no student records can be opened.

## Replace a Lost or Shared Code

```sh
node tools/publish-grades.mjs publish --rotate DEMO001
```

Distribute the replacement privately, then commit and push all generated changes,
including deletions. Other students retain their existing codes. Removing a
student from the gradebook removes their current encrypted record on the next
export. **Neither deletion nor rotation revokes a previously downloaded record
or an older record retained in Git history.** A person holding the old code and
an old encrypted record can still read that old snapshot.

## Security Model and Limits

- Generated codes contain 32 cryptographically random bytes (256 bits), not
  guessable PINs. Anyone holding a code has access to that student's record.
- HKDF-SHA-256 derives a per-record AES-256-GCM key with a fresh random salt.
  Every export uses a fresh 96-bit nonce. The authentication tag also binds
  the encrypted data to its opaque lookup ID and the Calculus I context.
- Public files contain no names, student IDs, readable scores, code list, or
  decryption keys. Fixed-length padding hides relative record sizes. File
  counts and publication timing remain visible.
- A modified page can bypass the UI, but it cannot decrypt another student's
  record without that student's code. Automated guessing is not rate-limited
  on this static host; security relies on randomly generated 256-bit secrets.
- Codes are entered as passwords, kept out of URLs and storage, and are not
  sent to a login server. An opaque code-derived lookup hash is sent to the
  host. The grade page includes no analytics, remote fonts, or third-party
  JavaScript. It uses a restrictive Content Security Policy and text-only DOM
  rendering. HTTPS is required outside local testing.
- Grades are cleared on tab hiding, page navigation, manual lock, and five
  minutes of inactivity. This removes the application's references and visible
  DOM; JavaScript cannot guarantee secure erasure of browser/process memory.
  Extensions, malware, screenshots, shared codes, compromised hosting, and
  malicious scripts elsewhere on the same origin remain outside this design.
- GitHub Pages does not supply identity verification, server-side authorization,
  audit logs, immediate snapshot revocation, or a guarantee against hacking.
  For institutionally managed access, use the university LMS or a backend with
  school-account login and authorization for every grade request. Confirm that
  the university permits this hosting arrangement before publishing real grades.

The design uses the browser's standard Web Crypto implementation. References:
[MDN HKDF and AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey),
[OWASP cryptographic storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html),
[GitHub Pages HTTPS and public hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

## Verification

```sh
node --test tools/grades.test.mjs
python3 -m unittest discover -s tools -p 'test_import_grades.py'
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/teaching-site/calculus-1-grades.html` for local testing.
For real use, open the deployed HTTPS page. Tests use fictional data in temporary
folders and do not create public demo records or print access codes.
