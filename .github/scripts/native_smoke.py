"""Integration checks against a compiled sidecar and real TeX/Poppler tools.

Run with LATTICE_BACKEND=/absolute/path/to/lattice-backend python3 this_file.py -v.
Every document and generated file lives in a disposable directory.
"""

import base64
import itertools
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import tempfile
import unittest


REPOSITORY = Path(__file__).resolve().parents[2]
ENGINES = ("pdflatex", "xelatex", "lualatex")


class NativeIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = Path(os.environ["LATTICE_BACKEND"]).resolve(strict=True)
        for executable in (*ENGINES, "latexmk", "pdftocairo", "synctex"):
            if shutil.which(executable) is None:
                raise RuntimeError(f"Required integration tool is missing: {executable}")

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="lattice native ")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.process = subprocess.Popen(
            [str(self.backend)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            # Use a file so unexpected logging cannot fill a stderr pipe.
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        self.addCleanup(self.stop_backend)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.addCleanup(self.selector.close)
        self.next_id = 0

    def stop_backend(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGKILL)
        self.process.wait(timeout=5)
        self.process.stdin.close()
        self.process.stdout.close()

    def exchange(self, line):
        self.process.stdin.write((line + "\n").encode())
        self.process.stdin.flush()
        self.assertTrue(self.selector.select(timeout=110), "Backend response timed out")
        response = self.process.stdout.readline()
        self.assertTrue(response, "Backend exited without a response")
        return json.loads(response)

    def rpc(self, command, **args):
        self.next_id += 1
        response = self.exchange(json.dumps({"id": self.next_id, "command": command, "args": args}))
        self.assertEqual(response["id"], self.next_id)
        return response

    def success(self, command, **args):
        response = self.rpc(command, **args)
        self.assertNotIn("error", response, response.get("error"))
        self.assertIn("result", response)
        return response["result"]

    def project(self, name, fixture="simple-paper"):
        root = self.root / name
        root.mkdir()
        shutil.copyfile(REPOSITORY / "fixtures" / fixture / "main.tex", root / "main.tex")
        return {"root": str(root), "rootDocument": "main.tex"}

    def test_compilation_preview_and_navigation_for_every_engine_and_mode(self):
        detected = {engine["id"]: engine["available"] for engine in self.success("detect_engines")}
        self.assertTrue(all(detected.get(engine) for engine in ENGINES))
        for engine, background in itertools.product(ENGINES, (False, True)):
            with self.subTest(engine=engine, background=background):
                project = self.project(f"{engine} {background}")
                snapshot = self.success("read_project", root=project["root"])
                self.assertEqual(snapshot["rootDocument"], "main.tex")
                build = self.success("compile_project", **project, engine=engine, background=background)
                self.assertTrue(build["success"], build["log"])
                self.assertTrue(base64.b64decode(build["pdfBase64"]).startswith(b"%PDF-"))
                self.assertTrue(build["pdfVersion"])
                preview = self.success("render_pdf_page", **project, pdfVersion=build["pdfVersion"], page=1)
                self.assertIn(b"<svg", base64.b64decode(preview["svgBase64"]))
                for page, version in ((0, build["pdfVersion"]), (1, "stale")):
                    with self.subTest(page=page, version=version):
                        self.assertIn("error", self.rpc("render_pdf_page", **project, pdfVersion=version, page=page))
                position = self.success("forward_search", **project, path="main.tex", line=11, column=1)
                self.assertGreater(position["page"], 0)
                source = self.success("inverse_search", **project, page=position["page"], x=position["x"], y=position["y"])
                self.assertEqual(source["path"], "main.tex")
                self.assertGreater(source["line"], 0)

    def test_failed_build_diagnostics_and_recovery(self):
        for engine in ENGINES:
            with self.subTest(engine=engine):
                project = self.project(engine, "broken-document")
                failed = self.success("compile_project", **project, engine=engine)
                self.assertFalse(failed["success"])
                self.assertIsNone(failed["pdfBase64"])
                self.assertIsNone(failed["pdfVersion"])
                self.assertTrue(any(d["severity"] == "error" and d["line"] == 4 for d in failed["diagnostics"]), failed["log"])
                source = (REPOSITORY / "fixtures/simple-paper/main.tex").read_text()
                self.success("write_project_file", root=project["root"], path="main.tex", content=source)
                recovered = self.success("compile_project", **project, engine=engine)
                self.assertTrue(recovered["success"], recovered["log"])

    def test_rpc_rejections_leave_the_sidecar_usable(self):
        project = self.project("rejections")
        (self.root / "outside.tex").write_text("private source")
        requests = [
            ("unknown_command", {}),
            ("compile_project", {**project, "engine": "shell-command"}),
            ("compile_project", {"engine": "pdflatex"}),
            ("read_project_file", {"root": project["root"], "path": "../outside.tex"}),
            ("write_project_file", {"root": project["root"], "path": "notes.txt", "content": "invalid"}),
            ("forward_search", {**project, "path": "main.tex", "line": 1, "column": 1}),
            ("inverse_search", {**project, "page": 0, "x": 0, "y": 0}),
        ]
        self.assertIn("error", self.exchange("not json"))
        for command, args in requests:
            with self.subTest(command=command, args=args):
                self.assertIn("error", self.rpc(command, **args))
                self.assertIsInstance(self.success("detect_engines"), list)
        self.assertFalse((Path(project["root"]) / "notes.txt").exists())


if __name__ == "__main__":
    unittest.main()
