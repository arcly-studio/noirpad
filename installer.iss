; ============================================================================
;  NoirPad — Inno Setup script
; ----------------------------------------------------------------------------
;  Per-user installer for the PyInstaller onedir build (dist\NoirPad\) into
;  %LOCALAPPDATA%\Programs\NoirPad. No admin rights, no UAC prompt.
;
;  Built by build.ps1, which passes the version and project URL from
;  noirpad\__version__.py:
;     ISCC /DAppVersion=x.y.z /DAppURL=https://github.com/... installer.iss
;
;  Notes live in %LOCALAPPDATA%\NoirPad (separate from the install dir).
;  Uninstalling removes the whole install dir. Before that it asks whether to
;  delete the notes too; preselected (and silent): they stay.
; ============================================================================

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z (build.ps1 does this from noirpad\__version__.py)
#endif
#ifndef AppURL
  #define AppURL "https://github.com/arcly-studio/noirpad"
#endif

#define AppName       "NoirPad"
#define AppPublisher  "Arcly Studio"
; N9: the copyright line of LICENSE (COPYRIGHT in noirpad\__version__.py).
#define AppCopyright  "Copyright (c) 2026 Arcly Studio. MIT License."
#define AppExeName    "NoirPad.exe"
#define SourceDir     "dist\NoirPad"
; Same name as APP_MUTEX in desktop.py: setup/uninstall see a running NoirPad.
#define AppMutexName  "NoirPad-B6F2E7C0-AppMutex"
; Data folder under %LOCALAPPDATA% (platformdirs user_data_dir in config.py).
#define DataDirName   "NoirPad"
; Read by noirpad\config.py install_language(): the wizard's language is
; the app's language while Settings → Language is "auto".
#define InstallLangFile "install-language.txt"
#define WebView2Guid  "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
#define WebView2Url   "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

[Setup]
; AppId — never change this once published; the uninstaller keys off it.
AppId={{B6F2E7C0-7C2B-4A3F-9C6A-2F7A4E1D9A11}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
VersionInfoVersion={#AppVersion}
VersionInfoProductVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Setup
VersionInfoCopyright={#AppCopyright}
AppCopyright={#AppCopyright}
LicenseFile=LICENSE

; Per-user install only — no elevation, no "install for all users" dialog.
PrivilegesRequired=lowest
; Always %LOCALAPPDATA%\Programs\NoirPad: no folder page, and an earlier
; install elsewhere is not reused. Uninstalling removes the whole folder,
; so it must never be one the user picked for other things too.
DefaultDirName={localappdata}\Programs\{#AppName}
DisableDirPage=yes
UsePreviousAppDir=no
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes

; A running NoirPad is detected (mutex) and closed via Restart Manager.
AppMutex={#AppMutexName}
CloseApplications=yes
RestartApplications=no

; 64-bit only — PyInstaller builds match the host Python, which is x64.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

OutputDir=dist\installer
OutputBaseFilename=NoirPad-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

SetupIconFile=noirpad.ico
; Logo in the wizard's top-right corner; Setup picks the size for the DPI.
; Rendered from docs\brand\noirpad-icon.svg by tools\make_icons.py.
WizardSmallImageFile=installer\wizard-small-55.bmp,installer\wizard-small-64.bmp,installer\wizard-small-69.bmp,installer\wizard-small-83.bmp,installer\wizard-small-92.bmp,installer\wizard-small-110.bmp,installer\wizard-small-138.bmp
WizardImageAlphaFormat=defined
UninstallDisplayIcon={app}\{#AppExeName}
; N1.11: tell Explorer to refresh its icons at the end of (un)install
; (SHChangeNotify SHCNE_ASSOCCHANGED). Otherwise an upgrade over 1.0.x at the
; same path can keep showing the old blue icon from the shell's icon cache.
ChangesAssociations=yes
; I5: Apps & features shows the version in its own column.
UninstallDisplayName={#AppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "czech";   MessagesFile: "compiler:Languages\Czech.isl"

[Messages]
; Not "... and all of its components": the notes have their own question.
english.ConfirmUninstall=Uninstall the program %1 from this computer?
czech.ConfirmUninstall=Odinstalovat program %1 z tohoto počítače?

[CustomMessages]
english.WebView2Missing=NoirPad needs the Microsoft Edge WebView2 Runtime, which is not installed on this computer.%n%nDownload and install it from Microsoft now?%n(If you choose No, NoirPad will remind you when it starts.)
czech.WebView2Missing=NoirPad potřebuje Microsoft Edge WebView2 Runtime, který na tomto počítači není nainstalovaný.%n%nStáhnout ho teď od Microsoftu a nainstalovat?%n(Když zvolíte Ne, NoirPad vám to připomene při spuštění.)
english.WebView2Failed=WebView2 could not be installed automatically (%1).%n%nThe download page will open in your browser.
czech.WebView2Failed=WebView2 se nepodařilo nainstalovat automaticky (%1).%n%nV prohlížeči se otevře stránka ke stažení.
english.DirNotEmpty=The folder %1 already contains other files.%n%nUninstalling NoirPad removes its whole folder, so Setup will not install there. Move those files elsewhere (or delete them) and run Setup again.
czech.DirNotEmpty=Složka %1 už obsahuje jiné soubory.%n%nOdinstalace NoirPadu maže celou jeho složku, proto do ní instalátor nic nenainstaluje. Přesuňte ty soubory jinam (nebo je smažte) a spusťte instalaci znovu.
english.AppStillRunning=NoirPad is still running and cannot be removed while it is open.%n%nClose it now? Unsaved changes in an open note may be lost.
czech.AppStillRunning=NoirPad pořád běží a nejde odebrat, dokud je otevřený.%n%nZavřít ho teď? Neuložené změny v otevřené poznámce se mohou ztratit.
english.NotesQuestionTitle=What should happen to your notes?
czech.NotesQuestionTitle=Co se má stát s vašimi poznámkami?
english.NotesQuestion=Your notes, backups and settings are in this folder:%n%n%1%n%nDeleting them cannot be undone. Keep them if you plan to install NoirPad again.
czech.NotesQuestion=Vaše poznámky, zálohy a nastavení jsou v této složce:%n%n%1%n%nSmazání nejde vrátit. Ponechte je, pokud budete NoirPad instalovat znovu.
english.KeepNotes=Keep my notes
czech.KeepNotes=Ponechat poznámky
english.DeleteNotes=Delete my notes too
czech.DeleteNotes=Smazat i poznámky
english.DataLeftTitle=Some of your data could not be deleted
czech.DataLeftTitle=Část vašich dat se nepodařilo smazat
english.DataLeft=The program is removed, but this is still in %1:%n%n%2%n%nAnother program is probably using it. Close that program and delete the folder yourself.
czech.DataLeft=Program je odebraný, ale ve složce %1 zůstalo:%n%n%2%n%nNejspíš to používá jiný program. Zavřete ho a složku smažte ručně.
english.DataLeftFolder=(the empty folder itself)
czech.DataLeftFolder=(samotná prázdná složka)
english.DataLeftMore=… and %1 more
czech.DataLeftMore=… a další: %1
english.OpenFolder=Open the folder
czech.OpenFolder=Otevřít složku
english.CloseWindow=Close
czech.CloseWindow=Zavřít

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; An upgrade must not leave the previous build's modules behind: the exe
; imports whatever is in _internal\, and a stale websockets package from an
; older build is what broke the first release test install. Only program
; files live here; notes are in %LOCALAPPDATA%\NoirPad.
Type: filesandordirs; Name: "{app}\_internal"

[Files]
; The bootloader (NoirPad.exe) and _internal\ must stay together.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; N8/N9: the licences next to NoirPad.exe (the app shows them in About too).
Source: "LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"; IconFilename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Everything in the install dir, including files added after installing.
; Only program files live here (the folder is fixed, see DisableDirPage);
; notes are in %LOCALAPPDATA%\NoirPad.
Type: filesandordirs; Name: "{app}"

[Code]
var
  DownloadPage: TDownloadWizardPage;
  WantWebView2: Boolean;

function WebView2Installed(): Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{#WebView2Guid}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{#WebView2Guid}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{#WebView2Guid}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

procedure InitializeWizard();
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), nil);
end;

function InitializeSetup(): Boolean;
begin
  WantWebView2 := False;
  if not WebView2Installed() and not WizardSilent() then
    WantWebView2 := MsgBox(CustomMessage('WebView2Missing'), mbConfirmation, MB_YESNO) = IDYES;
  Result := True;
end;

procedure OpenWebView2Page(Reason: String);
var
  Code: Integer;
begin
  MsgBox(FmtMessage(CustomMessage('WebView2Failed'), [Reason]), mbInformation, MB_OK);
  ShellExec('open', '{#WebView2Url}', '', '', SW_SHOWNORMAL, ewNoWait, Code);
end;

// [UninstallDelete] removes the whole install dir, so it must hold nothing
// but NoirPad: an existing folder is accepted only when it is empty or
// already has NoirPad.exe in it (upgrade / reinstall).
function UnsafeInstallDir(const Dir: String): Boolean;
var
  Rec: TFindRec;
begin
  Result := False;
  if not DirExists(Dir) or FileExists(AddBackslash(Dir) + '{#AppExeName}') then
    exit;
  if FindFirst(AddBackslash(Dir) + '*', Rec) then
  try
    repeat
      if (Rec.Name <> '.') and (Rec.Name <> '..') then
      begin
        Result := True;
        exit;
      end;
    until not FindNext(Rec);
  finally
    FindClose(Rec);
  end;
end;

{ I3: a silent install (/VERYSILENT: winget, store) installs WebView2 too,
  without asking and without any window. A failure is only logged — NoirPad
  explains it at its first start. }
procedure InstallWebView2Silently();
var
  Code: Integer;
begin
  try
    DownloadTemporaryFile('{#WebView2Url}', 'MicrosoftEdgeWebview2Setup.exe', '', nil);
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '',
                SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      Log(Format('WebView2 setup failed: exit code %d', [Code]));
  except
    Log('WebView2 download failed: ' + GetExceptionMessage);
  end;
end;

{ Evergreen bootstrapper from Microsoft, run per-user and silently. }
function NextButtonClick(CurPageID: Integer): Boolean;
var
  Code: Integer;
begin
  Result := True;
  if (CurPageID <> wpReady) or not WantWebView2 then
    exit;
  DownloadPage.Clear;
  DownloadPage.Add('{#WebView2Url}', 'MicrosoftEdgeWebview2Setup.exe', '');
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
      if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '',
                  SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
        OpenWebView2Page(Format('exit code %d', [Code]));
    except
      OpenWebView2Page(GetExceptionMessage);
    end;
  finally
    DownloadPage.Hide;
  end;
end;

function DataDir(): String;
begin
  Result := ExpandConstant('{localappdata}\{#DataDirName}');
end;

// ---- Processes that lock the install dir ----------------------------------
// NoirPad.exe started from the install dir. NoirPad holds AppMutex until its
// process is gone, so Setup and Uninstall already wait for an open NoirPad;
// this is the fallback for one that is still shutting down or hangs. Only
// those processes are ever closed. NoirPad's WebView2 processes (profile in
// the data folder) lock no program files; they are only waited for before
// the data folder is deleted. If WMI fails, nothing counts as running and
// Setup/Uninstall go on as they did before this check existed.

function StartsWithText(const S, Prefix: String): Boolean;
begin
  Result := (Length(S) >= Length(Prefix)) and
            (CompareText(Copy(S, 1, Length(Prefix)), Prefix) = 0);
end;

function VarText(const V: Variant): String;
begin
  if VarIsNull(V) or VarIsEmpty(V) then
    Result := ''
  else
    Result := V;
end;

var
  Wmi: Variant;

{ Space-separated PIDs, '' when none: NoirPad.exe from the install dir, or
  (WebViewProfile) the msedgewebview2.exe processes using NoirPad's profile. }
function MatchingProcessIds(WebViewProfile: Boolean): String;
var
  Locator, Items, Item: Variant;
  AppDir, Profile: String;
  I: Integer;
begin
  Result := '';
  AppDir := AddBackslash(ExpandConstant('{app}'));
  Profile := Lowercase(AddBackslash(DataDir()) + 'webview\');
  try
    if VarIsEmpty(Wmi) then
    begin
      Locator := CreateOleObject('WbemScripting.SWbemLocator');
      Wmi := Locator.ConnectServer('.', 'root\CIMV2');
    end;
    if WebViewProfile then
      Items := Wmi.ExecQuery('SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = ''msedgewebview2.exe''')
    else
      Items := Wmi.ExecQuery('SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = ''{#AppExeName}''');
    for I := 0 to Items.Count - 1 do
    begin
      Item := Items.ItemIndex(I);
      if WebViewProfile then
      begin
        if Pos(Profile, Lowercase(VarText(Item.CommandLine))) > 0 then
          Result := Result + ' ' + IntToStr(Item.ProcessId);
      end
      else if StartsWithText(VarText(Item.ExecutablePath), AppDir) then
        Result := Result + ' ' + IntToStr(Item.ProcessId);
    end;
  except
    Log('Listing processes failed: ' + GetExceptionMessage);
  end;
  Result := Trim(Result);
end;

function AppProcessIds(): String;
begin
  Result := MatchingProcessIds(False);
end;

function GetTickCount: DWORD; external 'GetTickCount@kernel32.dll stdcall';

function WaitForAppExit(Seconds: Integer): Boolean;
var
  Deadline: DWORD;
begin
  Deadline := GetTickCount + Seconds * 1000;
  repeat
    Result := AppProcessIds() = '';
    if Result or (GetTickCount >= Deadline) then
      exit;
    Sleep(250);
  until False;
end;

procedure KillProcesses(Pids: String; Force: Boolean);
var
  Pid: String;
  P, Code: Integer;
begin
  Pids := Pids + ' ';
  while Trim(Pids) <> '' do
  begin
    P := Pos(' ', Pids);
    Pid := Copy(Pids, 1, P - 1);
    Delete(Pids, 1, P);
    if Pid = '' then
      continue;
    if Force then
      Pid := '/F /PID ' + Pid
    else
      Pid := '/PID ' + Pid;
    Log('taskkill ' + Pid);
    Exec(ExpandConstant('{sys}\taskkill.exe'), Pid, '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;
end;

// True when nothing from the install dir runs any more (asks first unless silent).
function CloseAppProcesses(Silent: Boolean): Boolean;
begin
  Result := True;
  if WaitForAppExit(5) then
    exit;
  Log('Still running from the install dir: ' + AppProcessIds());
  if not Silent and
     (MsgBox(CustomMessage('AppStillRunning'), mbConfirmation, MB_YESNO) <> IDYES) then
  begin
    Result := False;
    exit;
  end;
  KillProcesses(AppProcessIds(), False);    { WM_CLOSE first }
  if WaitForAppExit(5) then
    exit;
  KillProcesses(AppProcessIds(), True);
  Result := WaitForAppExit(5);
  if not Result then
    Log('Could not stop: ' + AppProcessIds());
end;

// Upgrade: [InstallDelete] removes the old _internal, which NoirPad locks.
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if UnsafeInstallDir(ExpandConstant('{app}')) then
    Result := FmtMessage(CustomMessage('DirNotEmpty'), [ExpandConstant('{app}')])
  else if not CloseAppProcesses(WizardSilent()) then
    Result := SetupMessage(msgSetupAppRunningError)
  else if WizardSilent() and not WebView2Installed() then
    InstallWebView2Silently();
end;

var
  DeleteNotes: Boolean;

{ The one question about the notes, before anything is removed. The first
  button is preselected (TaskDialogMsgBox knows no MB_DEFBUTTON2), so Keep is
  "Yes"; only a click on Delete ("No") deletes. Silent: no question, kept. }
function AskAboutNotes(): Boolean;
begin
  Result := False;
  if not DirExists(DataDir()) then
    exit;
  if UninstallSilent() then
  begin
    Log('Silent uninstall: the data folder is kept: ' + DataDir());
    exit;
  end;
  Result := TaskDialogMsgBox(CustomMessage('NotesQuestionTitle'),
    FmtMessage(CustomMessage('NotesQuestion'), [DataDir()]), mbConfirmation,
    MB_YESNO, [CustomMessage('KeepNotes'), CustomMessage('DeleteNotes')], 0) = IDNO;
  if Result then
    Log('The data folder will be deleted: ' + DataDir())
  else
    Log('The data folder is kept: ' + DataDir());
end;

function InitializeUninstall(): Boolean;
begin
  DeleteNotes := False;
  Result := CloseAppProcesses(UninstallSilent());
  if Result then
    DeleteNotes := AskAboutNotes();
end;

{ The wizard's language is NoirPad's language while Settings → Language is
  "auto"; a language picked there always wins. Rewritten on every install. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  Lang: String;
begin
  if CurStep <> ssPostInstall then
    exit;
  if ActiveLanguage() = 'czech' then
    Lang := 'cs'
  else
    Lang := 'en';
  if not ForceDirectories(DataDir()) or
     not SaveStringToFile(AddBackslash(DataDir()) + '{#InstallLangFile}', Lang, False) then
    Log('Could not write {#InstallLangFile}');
end;

// True when the whole data folder is gone; tried again for a few seconds
// while something still holds a file in it.
function DeleteDataFolder(): Boolean;
var
  I: Integer;
begin
  // WebView2 may still be closing NoirPad's profile; never kill it, wait.
  for I := 1 to 40 do
    if MatchingProcessIds(True) = '' then
      break
    else
      Sleep(250);
  for I := 1 to 20 do
  begin
    DelTree(DataDir(), True, True, True);
    Result := not DirExists(DataDir());
    if Result then
      exit;
    Sleep(500);
  end;
end;

{ Files left under Dir: the first five into List, all of them into Count. }
procedure ListFiles(const Dir, Prefix: String; var List: String; var Count: Integer);
var
  Rec: TFindRec;
begin
  if not FindFirst(AddBackslash(Dir) + '*', Rec) then
    exit;
  try
    repeat
      if (Rec.Name = '.') or (Rec.Name = '..') then
        continue;
      if (Rec.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
        ListFiles(AddBackslash(Dir) + Rec.Name, Prefix + Rec.Name + '\', List, Count)
      else
      begin
        Count := Count + 1;
        if Count <= 5 then
          List := List + Prefix + Rec.Name + #13#10;
      end;
    until not FindNext(Rec);
  finally
    FindClose(Rec);
  end;
end;

procedure ReportLeftData();
var
  List: String;
  Count, Code: Integer;
begin
  List := '';
  Count := 0;
  ListFiles(DataDir(), '', List, Count);
  if Count = 0 then
    List := CustomMessage('DataLeftFolder')
  else if Count > 5 then
    List := List + FmtMessage(CustomMessage('DataLeftMore'), [IntToStr(Count - 5)]);
  Log(Format('Could not delete the data folder %s, files left: %d', [DataDir(), Count]));
  if TaskDialogMsgBox(CustomMessage('DataLeftTitle'),
       FmtMessage(CustomMessage('DataLeft'), [DataDir(), Trim(List)]), mbError,
       MB_YESNO, [CustomMessage('OpenFolder'), CustomMessage('CloseWindow')], 0) = IDYES then
    ShellExec('open', DataDir(), '', '', SW_SHOWNORMAL, ewNoWait, Code);
end;

{ The answer given at the start, after the program is gone. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and DeleteNotes then
    if not DeleteDataFolder() then
      ReportLeftData();
end;
