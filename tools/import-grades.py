"""Local-only Excel import and private access-code handout generation."""

import argparse
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import uuid

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill


REPO = Path(__file__).resolve().parents[1]
PRIVATE = REPO.parent / "private-grades" / "calculus-1"
CATEGORIES = ("quiz", "midterm", "homework", "final")
GRADE_URL = "https://wfudong.github.io/teaching-site/calculus-1-grades.html?lang=zh"


def prepare_private(directory):
    directory = Path(directory)
    if directory.resolve().is_relative_to(REPO.resolve()):
        raise ValueError("Private files must remain outside the public website repository.")
    if directory.is_symlink():
        raise ValueError("Private directory cannot be a symlink.")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    return directory


def read_private(file):
    if file.is_symlink():
        raise ValueError("Private files cannot be symlinks.")
    file.chmod(0o600)
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raise ValueError("Invalid private JSON file; review it locally.") from None


def write_private(file, data):
    if file.is_symlink():
        raise ValueError("Private files cannot be symlinks.")
    temporary = file.with_name(f"{file.name}.{uuid.uuid4().hex}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        temporary.replace(file)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(file, value):
    data = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    write_private(file, data.encode("utf-8"))


def score_value(cell):
    if cell.data_type in ("f", "e"):
        raise ValueError(f"Formula or Excel error in grade cell {cell.coordinate}; supply a recorded value.")
    value = cell.value
    if value is None or isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, bool):
        raise ValueError(f"Boolean grade in cell {cell.coordinate} is not supported.")
    if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0:
        return value
    if isinstance(value, str) and len(value.strip()) <= 32:
        return value.strip()
    raise ValueError(f"Unsupported grade in cell {cell.coordinate}; review it locally.")


def parse_workbook(source, quiz_max=None):
    if quiz_max is not None and (not math.isfinite(quiz_max) or quiz_max <= 0):
        raise ValueError("Quiz maximum must be a positive number.")
    workbook = openpyxl.load_workbook(source, data_only=False)
    students = []
    roster = []
    seen = set()
    report = {"groups": [], "blank_cells": [], "numeric_results": 0, "letter_results": 0}
    try:
        for sheet in workbook:
            headers = {str(cell.value).strip(): cell.column for cell in sheet[1] if cell.value is not None}
            if not {"学号", "姓名"}.issubset(headers):
                raise ValueError("Each sheet must have student ID and name headers in row 1.")
            assessments = []
            labels = set()
            for cell in sheet[1]:
                match = re.fullmatch(r"(quiz|hw|homework)\s*(\d+)", str(cell.value).strip(), re.I)
                if not match:
                    continue
                category = "quiz" if match[1].lower() == "quiz" else "homework"
                number = int(match[2])
                label = f"{'Quiz' if category == 'quiz' else 'Homework'} {number}"
                if label in labels:
                    raise ValueError("Duplicate assessment header in a sheet.")
                labels.add(label)
                assessments.append((cell.column, category, label))
            if not assessments:
                raise ValueError("No Quiz or HW assessment columns were found.")
            group_count = 0
            for row in range(2, sheet.max_row + 1):
                if all(sheet.cell(row, col).value is None for col in range(1, sheet.max_column + 1)):
                    continue
                id_cell = sheet.cell(row, headers["学号"])
                name_cell = sheet.cell(row, headers["姓名"])
                if id_cell.data_type in ("f", "e") or name_cell.data_type in ("f", "e"):
                    raise ValueError(f"Formula or error in identity cells on row {row}.")
                if not isinstance(id_cell.value, str):
                    raise ValueError(f"Student ID on row {row} must be stored as text to preserve leading zeros.")
                student_id = id_cell.value.strip()
                name = name_cell.value.strip() if isinstance(name_cell.value, str) else ""
                if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", student_id) or not name or len(name) > 120:
                    raise ValueError(f"Invalid or missing student ID/name on row {row}.")
                if student_id in seen:
                    raise ValueError(f"Duplicate student ID at row {row}; no files have been imported.")
                seen.add(student_id)
                grades = {category: [] for category in CATEGORIES}
                for column, category, label in assessments:
                    cell = sheet.cell(row, column)
                    score = score_value(cell)
                    maximum = quiz_max if category == "quiz" and not isinstance(score, str) else None
                    grades[category].append({"label": label, "score": score, "max_score": maximum})
                    if score is None:
                        report["blank_cells"].append({"group": sheet.title, "cell": cell.coordinate, "assessment": label})
                    elif isinstance(score, str):
                        report["letter_results"] += 1
                    else:
                        report["numeric_results"] += 1
                students.append({"student_id": student_id, "name": name, "grades": grades})
                roster.append({"student_id": student_id, "name": name, "group": sheet.title, "row": row})
                group_count += 1
            report["groups"].append({"group": sheet.title, "students": group_count})
    finally:
        workbook.close()
    if not students:
        raise ValueError("The workbook has no student records.")
    report["student_count"] = len(students)
    report["quiz_maximum"] = quiz_max
    return students, roster, report


def import_workbook(source, directory=PRIVATE, quiz_max=None):
    # Parse all sheets before modifying private data, so malformed imports fail closed.
    imported, roster, report = parse_workbook(source, quiz_max)
    directory = prepare_private(directory)
    book_file = directory / "gradebook.json"
    book = read_private(book_file) if book_file.exists() else {"students": []}
    if not isinstance(book, dict) or not isinstance(book.get("students"), list):
        raise ValueError("Invalid existing private gradebook.")
    existing = {student["student_id"]: student for student in book["students"]}
    if len(existing) != len(book["students"]):
        raise ValueError("Existing gradebook contains duplicate IDs.")
    for incoming in imported:
        current = existing.get(incoming["student_id"])
        if current is None:
            book["students"].append(incoming)
            continue
        current["name"] = incoming["name"]
        for category in ("quiz", "homework"):
            by_label = {entry["label"]: entry for entry in current["grades"][category]}
            for entry in incoming["grades"][category]:
                if entry["label"] in by_label:
                    old = by_label[entry["label"]]
                    # Retain a previously supplied numeric maximum if the sheet omits it.
                    if entry["max_score"] is None and not isinstance(entry["score"], str):
                        entry["max_score"] = old["max_score"]
                    old.update(entry)
                else:
                    current["grades"][category].append(entry)
    if book_file.exists():
        write_private(directory / f"gradebook-backup-{uuid.uuid4().hex}.json", book_file.read_bytes())
    write_json(book_file, book)
    write_json(directory / "import-roster.json", roster)
    write_json(directory / "import-report.json", report)
    return report


def export_codes(directory=PRIVATE):
    directory = prepare_private(directory)
    roster = read_private(directory / "import-roster.json")
    saved = read_private(directory / "access-codes.json")
    codes = {entry["student_id"]: entry["access_code"] for entry in saved["students"]}
    if len(codes) != len(saved["students"]) or len(set(codes.values())) != len(codes):
        raise ValueError("Duplicate private codes or IDs.")
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Student Codes"
    sheet.merge_cells("A1:E1")
    sheet["A1"] = "CONFIDENTIAL: give each student only their own code. Never share this workbook."
    sheet["A1"].font = Font(bold=True, color="FFFFFF", size=12)
    sheet["A1"].fill = PatternFill("solid", fgColor="15324F")
    sheet["A1"].alignment = Alignment(vertical="center")
    sheet.row_dimensions[1].height = 32
    for column, header in enumerate(("Group / 分组", "Student ID / 学号", "Name / 姓名", "Private access code / 查询码", "Grade page / 查询网址"), 1):
        cell = sheet.cell(2, column, header)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="24587A")
    for row_number, student in enumerate(roster, 3):
        code = codes.get(student["student_id"])
        if not isinstance(code, str) or not re.fullmatch(r"C1-[A-Za-z0-9_-]{43}", code):
            raise ValueError("Missing student code; run the encryption publisher first.")
        values = (student["group"], student["student_id"], student["name"], code, GRADE_URL)
        for column, value in enumerate(values, 1):
            cell = sheet.cell(row_number, column)
            cell.value = value
            cell.data_type = "s"  # Prevent formula injection from names or labels.
            cell.number_format = "@"
            cell.alignment = Alignment(vertical="center")
            if row_number % 2:
                cell.fill = PatternFill("solid", fgColor="EDF4F8")
        sheet.row_dimensions[row_number].height = 25
        sheet.cell(row_number, 4).font = Font(name="Consolas", size=11)
    for column, width in (("A", 18), ("B", 22), ("C", 20), ("D", 61), ("E", 90)):
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = "D3"
    sheet.auto_filter.ref = f"A2:E{sheet.max_row}"
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A3
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.print_title_rows = "1:2"
    buffer = io.BytesIO()
    workbook.save(buffer)
    workbook.close()
    file = directory / "student-access-codes.xlsx"
    write_private(file, buffer.getvalue())
    return len(roster)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    importer = commands.add_parser("import", help="Import an Excel gradebook locally.")
    importer.add_argument("workbook", type=Path)
    importer.add_argument("--quiz-max", type=float, help="Only supply an officially confirmed maximum.")
    commands.add_parser("codes", help="Create the private access-code workbook after encryption.")
    args = parser.parse_args()
    try:
        if args.command == "import":
            report = import_workbook(args.workbook, quiz_max=args.quiz_max)
            print(f"Imported {report['student_count']} students from {len(report['groups'])} groups locally.")
            print("Blank results and letter marks were preserved. No files were uploaded.")
        else:
            count = export_codes()
            print(f"Prepared the confidential code workbook for {count} students in ../private-grades/calculus-1/.")
    except (ValueError, OSError, KeyError, TypeError):
        # Avoid printing workbook contents, names, codes, or parser excerpts.
        print("Grade import/export failed. Check the workbook headers, duplicate IDs, formulas, and local file permissions.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
