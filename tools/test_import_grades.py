import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import openpyxl


spec = importlib.util.spec_from_file_location("grade_import", Path(__file__).with_name("import-grades.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GradeImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="gbu-grade-import-")
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "fictional-grades.xlsx"
        self.private = self.directory / "private"

    def tearDown(self):
        self.temporary.cleanup()

    def workbook(self, duplicate=False, formula=False):
        workbook = openpyxl.Workbook()
        first = workbook.active
        first.title = "Group 1"
        first.append(["学号", "姓名", "HW1", "Quiz1", "HW2", "Quiz2", "HW4", "Quiz4"])
        first.append(["00100001", "Fictional One", "P", "=1+1" if formula else 0, None, None])
        second = workbook.create_sheet("Group 2")
        second.append(["学号", "姓名", "HW1", "Quiz1", "HW2", "Quiz2", "HW4", "Quiz4"])
        second.append(["00100001" if duplicate else "00100002", "Fictional Two", "P", 9, "P", 10])
        workbook.save(self.source)
        workbook.close()

    def test_zero_is_preserved_completed_blanks_become_np_and_future_blanks_stay_unrecorded(self):
        self.workbook()
        before = hashlib.sha256(self.source.read_bytes()).digest()
        students, roster, report = module.parse_workbook(self.source)
        self.assertEqual([s["student_id"] for s in students], ["00100001", "00100002"])
        self.assertEqual(students[0]["grades"]["quiz"][0], {"label": "Quiz 1", "score": 0, "max_score": None})
        self.assertEqual(students[0]["grades"]["quiz"][1]["score"], "NP")
        self.assertEqual(students[0]["grades"]["homework"][0]["score"], "P")
        self.assertEqual(students[0]["grades"]["homework"][1]["score"], "NP")
        self.assertIsNone(students[0]["grades"]["quiz"][2]["score"])
        self.assertIsNone(students[0]["grades"]["homework"][2]["score"])
        self.assertEqual(report["student_count"], 2)
        self.assertEqual(len(report["blank_cells"]), 6)
        self.assertEqual(report["np_results"], 2)
        self.assertEqual(roster[1]["group"], "Group 2")
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).digest(), before)

    def test_explicit_maximum_is_optional_and_does_not_apply_to_homework_letters(self):
        self.workbook()
        students, _, _ = module.parse_workbook(self.source, quiz_max=10)
        self.assertEqual(students[1]["grades"]["quiz"][0]["max_score"], 10)
        self.assertIsNone(students[1]["grades"]["homework"][0]["max_score"])
        with self.assertRaises(ValueError):
            module.parse_workbook(self.source, quiz_max=-1)

    def test_later_quiz_zero_marks_assessment_started_across_groups(self):
        self.workbook()
        workbook = openpyxl.load_workbook(self.source)
        workbook["Group 2"]["H2"] = 0
        workbook.save(self.source)
        workbook.close()
        students, _, _ = module.parse_workbook(self.source)
        self.assertEqual(students[0]["grades"]["quiz"][2]["score"], "NP")
        self.assertEqual(students[1]["grades"]["quiz"][2]["score"], 0)
        self.assertIsNone(students[0]["grades"]["homework"][2]["score"])

    def test_later_homework_mark_makes_other_group_blank_np(self):
        self.workbook()
        workbook = openpyxl.load_workbook(self.source)
        workbook["Group 1"]["G2"] = "P"
        workbook.save(self.source)
        workbook.close()
        students, _, _ = module.parse_workbook(self.source)
        self.assertEqual(students[0]["grades"]["homework"][2]["score"], "P")
        self.assertEqual(students[1]["grades"]["homework"][2]["score"], "NP")
        self.assertIsNone(students[1]["grades"]["quiz"][2]["score"])

    def test_duplicate_ids_and_formulas_are_refused_before_writing(self):
        for invalid in ("duplicate", "formula"):
            self.workbook(duplicate=invalid == "duplicate", formula=invalid == "formula")
            with self.assertRaises(ValueError):
                module.import_workbook(self.source, self.private)
            self.assertFalse(self.private.exists())

    def test_updates_preserve_other_students_exams_comments_and_confirmed_maxima(self):
        self.workbook()
        module.import_workbook(self.source, self.private, quiz_max=10)
        book_file = self.private / "gradebook.json"
        book = json.loads(book_file.read_text())
        book["students"][0]["grades"]["midterm"] = [{"label": "Midterm", "score": 86, "max_score": 100}]
        book["students"][0]["grades"]["quiz"][0]["comment"] = "Keep feedback"
        demo = {"student_id": "DEMO_TEST", "name": "Demo", "grades": {category: [] for category in module.CATEGORIES}}
        book["students"].append(demo)
        module.write_json(book_file, book)
        module.import_workbook(self.source, self.private)
        updated = json.loads(book_file.read_text())
        self.assertEqual(len(updated["students"]), 3)
        self.assertEqual(updated["students"][0]["grades"]["midterm"][0]["score"], 86)
        self.assertEqual(updated["students"][0]["grades"]["quiz"][0]["comment"], "Keep feedback")
        self.assertEqual(updated["students"][0]["grades"]["quiz"][0]["max_score"], 10)
        self.assertEqual(len(list(self.private.glob("gradebook-backup-*.json"))), 1)

    def test_private_handout_keeps_ids_text_and_prevents_formula_injection(self):
        self.workbook()
        module.import_workbook(self.source, self.private)
        roster = json.loads((self.private / "import-roster.json").read_text())
        roster[0]["name"] = "=1+1"
        module.write_json(self.private / "import-roster.json", roster)
        module.write_json(self.private / "access-codes.json", {"version": 1, "students": [
            {"student_id": "00100001", "access_code": "C1-" + "A" * 43},
            {"student_id": "00100002", "access_code": "C1-" + "B" * 42 + "A"}
        ]})
        self.assertEqual(module.export_codes(self.private), 2)
        output = self.private / "student-access-codes.xlsx"
        workbook = openpyxl.load_workbook(output, data_only=False)
        sheet = workbook.active
        self.assertEqual(sheet["B3"].value, "00100001")
        self.assertEqual(sheet["C3"].value, "=1+1")
        self.assertEqual(sheet["C3"].data_type, "s")
        self.assertEqual(sheet.freeze_panes, "D3")
        self.assertEqual(sheet.auto_filter.ref, "A2:E4")
        self.assertTrue(all(cell.data_type != "f" for row in sheet for cell in row))
        workbook.close()
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.private.stat().st_mode & 0o777, 0o700)


if __name__ == "__main__":
    unittest.main()
