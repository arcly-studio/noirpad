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
;  Uninstalling removes the whole install dir and asks whether to delete the
;  notes too; the default is NO.
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
; I5: Apps & features shows the version in its own column.
UninstallDisplayName={#AppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "czech";   MessagesFile: "compiler:Languages\Czech.isl"

[CustomMessages]
english.WebView2Missing=NoirPad needs the Microsoft Edge WebView2 Runtime, which is not installed on this computer.%n%nDownload and install it from Microsoft now?%n(If you choose No, NoirPad will remind you when it starts.)
czech.WebView2Missing=NoirPad potřebuje Microsoft Edge WebView2 Runtime, který na tomto počítači není nainstalovaný.%n%nStáhnout ho teď od Microsoftu a nainstalovat?%n(Když zvolíte Ne, NoirPad vám to připomene při spuštění.)
english.WebView2Failed=WebView2 could not be installed automatically (%1).%n%nThe download page will open in your browser.
czech.WebView2Failed=WebView2 se nepodařilo nainstalovat automaticky (%1).%n%nV prohlížeči se otevře stránka ke stažení.
english.DirNotEmpty=The folder %1 already contains other files.%n%nUninstalling NoirPad removes its whole folder, so Setup will not install there. Move those files elsewhere (or delete them) and run Setup again.
czech.DirNotEmpty=Složka %1 už obsahuje jiné soubory.%n%nOdinstalace NoirPadu maže celou jeho složku, proto do ní instalátor nic nenainstaluje. Přesuňte ty soubory jinam (nebo je smažte) a spusťte instalaci znovu.
english.AppStillRunning=NoirPad is still running and cannot be removed while it is open.%n%nClose it now? Unsaved changes in an open note may be lost.
czech.AppStillRunning=NoirPad pořád běží a nejde odebrat, dokud je otevřený.%n%nZavřít ho teď? Neuložené změny v otevřené poznámce se mohou ztratit.
english.DeleteData=Also delete your notes, backups and settings?%n%n%1%n%nThis cannot be undone. Choose No to keep them (recommended if you plan to reinstall).
czech.DeleteData=Smazat i vaše poznámky, zálohy a nastavení?%n%n%1%n%nTo nejde vrátit. Zvolte Ne, pokud si je chcete nechat (doporučeno, pokud budete NoirPad instalovat znovu).

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

function InitializeUninstall(): Boolean;
begin
  Result := CloseAppProcesses(UninstallSilent());
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

{ Ask (default: No) whether the notes in %LOCALAPPDATA%\NoirPad go too. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  I: Integer;
begin
  if (CurUninstallStep <> usPostUninstall) or UninstallSilent() then
    exit;
  if not DirExists(DataDir()) then
    exit;
  if MsgBox(FmtMessage(CustomMessage('DeleteData'), [DataDir()]), mbConfirmation,
            MB_YESNO or MB_DEFBUTTON2) = IDYES then
  begin
    // WebView2 may still be closing NoirPad's profile; never kill it, wait.
    for I := 1 to 20 do
      if MatchingProcessIds(True) = '' then
        break
      else
        Sleep(250);
    DelTree(DataDir(), True, True, True);
  end;
end;
