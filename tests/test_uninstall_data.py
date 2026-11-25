"""N1.11 test, finding 3: an uninstall that was meant to delete the notes left
them all. The question came after the program was gone, as Yes / No with No
preselected, next to Inno's own "... and all of its components?", and the result
of the deletion was never looked at.

Now: one question about the notes before anything is removed, with buttons that
say what they do; deleting is retried and whatever is left is reported.

The second half runs the [Code] of installer.iss itself on a made-up folder. It
is compiled into a Setup that installs nothing (InitializeSetup returns False);
the data folder, the program folder and the windows are replaced."""

import ctypes
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import ROOT

ISS = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
CODE = ISS.split("[Code]", 1)[1]


def routine(name):
    """The text of one procedure / function of [Code]."""
    m = re.search(rf"^(?:procedure|function) {name}\b.*?^end;", CODE, re.S | re.M)
    assert m, f"{name} is missing in installer.iss"
    return m.group(0)


def message(lang, key):
    m = re.search(rf"^{lang}\.{key}=(.+)$", ISS, re.M)
    assert m, f"{lang}.{key}"
    return m.group(1)


# ---- the script -------------------------------------------------------------------

def test_the_question_comes_before_anything_is_removed():
    assert "AskAboutNotes()" in routine("InitializeUninstall")
    after = routine("CurUninstallStepChanged")
    assert "usPostUninstall" in after and "AskAboutNotes" not in after and "MsgBox" not in after


def test_buttons_say_what_they_do_and_keeping_is_preselected():
    """TaskDialogMsgBox has no MB_DEFBUTTON2: the first button is preselected.
    Only an explicit click on Delete deletes (a failed window returns 0)."""
    ask = routine("AskAboutNotes")
    assert re.search(r"MB_YESNO,\s*\[CustomMessage\('KeepNotes'\), CustomMessage\('DeleteNotes'\)\]", ask)
    assert re.search(r"=\s*IDNO;", ask) and "IDYES" not in ask
    assert message("english", "KeepNotes") == "Keep my notes"
    assert message("english", "DeleteNotes") == "Delete my notes too"
    assert message("czech", "KeepNotes") == "Ponechat poznámky"
    assert message("czech", "DeleteNotes") == "Smazat i poznámky"
    for lang in ("english", "czech"):
        assert "%1" in message(lang, "NotesQuestion")                 # the folder


def test_inno_s_own_question_does_not_speak_of_all_components():
    section = ISS.split("[Messages]", 1)[1].split("\n[", 1)[0]
    for lang in ("english", "czech"):
        text = re.search(rf"^{lang}\.ConfirmUninstall=(.+)$", section, re.M).group(1)
        assert "%1" in text and not re.search("component|součást", text)


def test_the_result_of_the_deletion_is_checked_and_reported():
    delete = routine("DeleteDataFolder")
    assert delete.index("MatchingProcessIds(True)") < delete.index("DelTree(DataDir(), True, True, True)")
    assert "DirExists(DataDir())" in delete
    finish = routine("CurUninstallStepChanged")
    assert "DeleteDataFolder()" in finish and "ReportLeftData()" in finish
    for lang in ("english", "czech"):
        assert "%1" in message(lang, "DataLeft") and "%2" in message(lang, "DataLeft")
        assert message(lang, "DataLeftTitle") and message(lang, "OpenFolder") and message(lang, "CloseWindow")


def test_a_silent_uninstall_keeps_the_notes_and_logs_it():
    ask = routine("AskAboutNotes")
    silent = ask.index("UninstallSilent()")
    assert silent < ask.index("Log(") < ask.index("TaskDialogMsgBox(")


# ---- the real code on a made-up folder ----------------------------------------------

def iscc():
    found = shutil.which("ISCC.exe")
    paths = [Path(found)] if found else []
    for base in ("ProgramFiles(x86)", "ProgramFiles"):
        paths.append(Path(os.environ.get(base, "C:/none")) / "Inno Setup 6" / "ISCC.exe")
    paths.append(Path(os.environ.get("LOCALAPPDATA", "C:/none")) / "Programs" / "Inno Setup 6" / "ISCC.exe")
    return next((p for p in paths if p.is_file()), None)


needs_inno = pytest.mark.skipif(sys.platform != "win32" or iscc() is None, reason="Inno Setup 6 not installed")

FAKES = r"""
var
  FakeAnswer: Integer;

procedure Note(S: String);
var
  Lines: TArrayOfString;
begin
  SetArrayLength(Lines, 1);
  Lines[0] := S;
  SaveStringsToUTF8FileWithoutBOM(ExpandConstant('{param:out}'), Lines, True);
end;

function FakeSilent(): Boolean;
begin
  Result := ExpandConstant('{param:quiet|0}') = '1';
end;

function FakeDialog(const Instruction, Text: String; const Typ: TMsgBoxType; const Buttons: Cardinal;
  const Labels: TArrayOfString; const Shield: Integer): Integer;
var
  I: Integer;
  S: String;
begin
  S := 'DIALOG ' + Instruction + '|' + Text + '|';
  for I := 0 to GetArrayLength(Labels) - 1 do
    S := S + '<' + Labels[I] + '>';
  Note(S);
  Result := FakeAnswer;
  FakeAnswer := IDNO;      { a second window: never "open the folder" }
end;

function FakeMsgBox(const Text: String; const Typ: TMsgBoxType; const Buttons: Integer): Integer;
begin
  Note('DIALOG ' + Text);
  Result := FakeAnswer;
end;

function FakeShellExec(const Verb, Filename, Params, WorkingDir: String; const ShowCmd: Integer;
  const Wait: TExecWait; var ErrorCode: Integer): Boolean;
begin
  Note('OPENS ' + Filename);
  Result := True;
end;
"""

RUN = r"""
function InitializeSetup(): Boolean;
begin
  Result := False;
  FakeAnswer := StrToInt(ExpandConstant('{param:answer|0}'));
  if InitializeUninstall() then
  begin
    Note('REMOVING THE PROGRAM');
    CurUninstallStepChanged(usUninstall);
    CurUninstallStepChanged(usPostUninstall);
    CurUninstallStepChanged(usDone);
  end;
  Note('DONE');
end;
"""


@pytest.fixture(scope="module")
def harness(tmp_path_factory):
    base = tmp_path_factory.mktemp("uninstall")
    data, app = base / "data" / "NoirPad", base / "app"
    app.mkdir()
    code = CODE
    for old, new in (("function InitializeSetup()", "function RealInitializeSetup()"),
                     ("procedure InitializeWizard()", "procedure RealInitializeWizard()"),
                     ("function NextButtonClick(", "function RealNextButtonClick("),
                     ("function PrepareToInstall(", "function RealPrepareToInstall("),
                     ("procedure CurStepChanged(", "procedure RealCurStepChanged(")):
        assert code.count(old) == 1, old
        code = code.replace(old, new)
    code = code.replace(r"ExpandConstant('{localappdata}\{#DataDirName}')", f"'{data}'")
    code = code.replace("ExpandConstant('{app}')", f"'{app}'")
    # No window ever shows and nothing is opened, whatever the script does.
    code = code.replace("UninstallSilent()", "FakeSilent()").replace("TaskDialogMsgBox(", "FakeDialog(")
    code = re.sub(r"\bMsgBox\(", "FakeMsgBox(", code)
    code = re.sub(r"\bShellExec\(", "FakeShellExec(", code)
    assert "localappdata" not in re.sub(r"//.*|\{[^#}]*\}", "", code), "the real data folder is still in the code"
    defines = "\n".join(line for line in ISS.splitlines() if line.startswith("#define"))
    languages = "[Languages]" + ISS.split("[Languages]", 1)[1].split("\n[", 1)[0]
    texts = "[CustomMessages]" + ISS.split("[CustomMessages]", 1)[1].split("\n[", 1)[0]
    script = base / "harness.iss"
    script.write_text("\n".join([
        defines, "[Setup]", "AppId=NoirPadUninstallTest", "AppName=NoirPad uninstall test", "AppVersion=1",
        "PrivilegesRequired=lowest", "CreateAppDir=no", "Uninstallable=no", f"OutputDir={base}",
        "OutputBaseFilename=harness", "ArchitecturesAllowed=x64compatible",
        "ArchitecturesInstallIn64BitMode=x64compatible", languages, texts, "[Code]", FAKES, code, RUN,
    ]), encoding="utf-8-sig")
    built = subprocess.run([str(iscc()), "/Q", str(script)], capture_output=True, text=True, timeout=120)
    assert built.returncode == 0, built.stdout + built.stderr

    class Harness:
        def clear(self):
            for p in data.rglob("*"):
                os.chmod(p, 0o666)
            shutil.rmtree(data.parent, ignore_errors=True)
            assert not data.exists()

        def fill(self):
            self.clear()
            for d in ("backups", "images", "logs", "webview/EBWebView/Default"):
                (data / d).mkdir(parents=True)
            for f in ("notes_data.json", "install-language.txt", "noirpad.lock", "logs/noirpad.log",
                      "images/a.png", "backups/x.zip", "webview/EBWebView/Default/History"):
                (data / f).write_text("x", encoding="utf-8")
            os.chmod(data / "images" / "a.png", 0o444)             # a read-only file is no obstacle

        def snapshot(self):
            return {str(p.relative_to(data)): (p.stat().st_mtime_ns, p.read_bytes())
                    for p in data.rglob("*") if p.is_file()}

        def run(self, answer=0, quiet=False, lang="english"):
            out = base / "out.txt"
            out.unlink(missing_ok=True)
            p = subprocess.Popen([str(base / "harness.exe"), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/CURRENTUSER",
                                  f"/LANG={lang}", f"/out={out}", f"/answer={answer}", f"/quiet={int(quiet)}"])
            try:
                p.wait(60)
            finally:
                if p.poll() is None:        # harness.exe runs a harness.tmp: the whole tree
                    subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
            text = out.read_text(encoding="utf-8-sig")
            assert text.rstrip().endswith("DONE"), text
            return text

    h = Harness()
    h.data = data
    return h


KEEP, DELETE = 6, 7                 # IDYES, IDNO


@needs_inno
@pytest.mark.parametrize("lang, label", [("english", "Delete my notes too"), ("czech", "Smazat i poznámky")])
def test_delete_removes_the_whole_folder(harness, lang, label):
    harness.fill()
    text = harness.run(DELETE, lang=lang)
    assert not harness.data.exists()
    assert text.count("DIALOG") == 1 and f"<{label}>" in text and str(harness.data) in text
    assert text.index("DIALOG") < text.index("REMOVING THE PROGRAM")


@needs_inno
@pytest.mark.parametrize("answer", [KEEP, 0, 2])          # Keep, a failed window, closed
def test_anything_but_delete_leaves_the_data_as_it_is(harness, answer):
    harness.fill()
    before = harness.snapshot()
    text = harness.run(answer)
    assert harness.snapshot() == before
    assert text.count("DIALOG") == 1


@needs_inno
def test_silent_asks_nothing_and_leaves_the_data(harness):
    harness.fill()
    before = harness.snapshot()
    assert "DIALOG" not in harness.run(DELETE, quiet=True)
    assert harness.snapshot() == before


@needs_inno
def test_no_data_folder_no_question(harness):
    harness.clear()
    assert "DIALOG" not in harness.run(DELETE)


@needs_inno
@pytest.mark.parametrize("lang, title", [("english", "could not be deleted"), ("czech", "se nepodařilo smazat")])
def test_a_file_in_use_is_reported_with_its_path(harness, lang, title):
    harness.fill()
    kernel = ctypes.windll.kernel32
    kernel.CreateFileW.restype = ctypes.c_void_p
    locked = harness.data / "webview" / "EBWebView" / "Default" / "History"
    handle = ctypes.c_void_p(kernel.CreateFileW(str(locked), 0x80000000, 1, None, 3, 0, None))   # no delete sharing
    try:
        text = harness.run(DELETE, lang=lang)
    finally:
        kernel.CloseHandle(handle)
    assert [p for p in harness.data.rglob("*") if p.is_file()] == [locked]       # all the rest is gone
    report = text.split("REMOVING THE PROGRAM", 1)[1]
    assert report.count("DIALOG") == 1 and title in report
    assert str(harness.data) in report and r"webview\EBWebView\Default\History" in report


@needs_inno
def test_a_file_let_go_meanwhile_is_deleted(harness):
    """Something lets go of the folder a moment later: retried, no report."""
    harness.fill()
    locker = subprocess.Popen([sys.executable, "-c",
                               "import ctypes,sys,time;ctypes.windll.kernel32.CreateFileW(sys.argv[1],0x80000000,1,None,3,0,None);"
                               "print('ok',flush=True);time.sleep(4)", str(harness.data / "notes_data.json")],
                              stdout=subprocess.PIPE, text=True)
    assert locker.stdout.readline().strip() == "ok"
    try:
        text = harness.run(DELETE)
    finally:
        locker.kill()
        locker.wait()
    assert not harness.data.exists()
    assert text.count("DIALOG") == 1
