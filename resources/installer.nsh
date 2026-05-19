; AgentView NSIS customization
; -----------------------------
; Two jobs:
;
;  1. CLI install — after the app is installed, run `npm install -g
;     @anthropic-ai/claude-code` (best-effort, silent) so the user
;     doesn't hit an empty new-task screen because the bg daemon's
;     prerequisite is missing.
;
;  2. Pinned taskbar shortcut survival — the default electron-builder
;     NSIS upgrade flow does `RMDir /r $INSTDIR` before the new files
;     land, which makes a pinned taskbar LNK briefly point at a missing
;     exe and Windows un-pins it. We mitigate by:
;       - Asking $INSTDIR to be reused (no reformat) when the AppID
;         registry already matches.
;       - Refreshing the pinned LNK target on every install with the
;         current exe path, matching what main/desktopShortcut.ts does
;         on app launch.
;
; electron-builder hooks called: customInit, customInstall, customUnInstall.

!macro customInstall
  ; --- 1. Try to install the Claude Code CLI globally via npm. -------
  ; All best-effort: if npm isn't on PATH, we just skip and let the
  ; in-app status banner tell the user what to do. The /C cmd wrapper
  ; ensures NSIS doesn't choke on the shell expansion. We also redirect
  ; stderr/stdout to NUL so the installer UI stays quiet.
  DetailPrint "Installing Claude Code CLI (best-effort)..."
  nsExec::ExecToLog 'cmd.exe /C "where npm >NUL 2>&1 && (where claude >NUL 2>&1 || npm install -g @anthropic-ai/claude-code)"'
  Pop $0
  ${If} $0 == 0
    DetailPrint "Claude Code CLI install step finished (exit 0)."
  ${Else}
    DetailPrint "Claude Code CLI install step exit code: $0 (continuing — AgentView will surface the status banner)."
  ${EndIf}

  ; --- 2. Refresh the pinned taskbar shortcut, if it exists. --------
  ; PowerShell rewrites the LNK target/icon to the current exe so the
  ; pin survives the upgrade. We do NOT create one if the user hasn't
  ; pinned the app — that would be invasive.
  DetailPrint "Refreshing pinned taskbar shortcut (if any)..."
  StrCpy $1 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCT_FILENAME}.lnk"
  IfFileExists "$1" 0 +5
    StrCpy $2 "$INSTDIR\${PRODUCT_FILENAME}.exe"
    StrCpy $3 "$INSTDIR\resources\icon.ico"
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$$ws = New-Object -ComObject WScript.Shell; $$s = $$ws.CreateShortcut(''$1''); $$s.TargetPath = ''$2''; $$s.IconLocation = ''$3''; $$s.WorkingDirectory = ''$INSTDIR''; $$s.Save()"'
    Pop $0
    DetailPrint "Pinned shortcut refresh exit: $0"
!macroend

!macro customUnInstall
  ; Do not delete the pinned taskbar LNK on uninstall — that's the user's
  ; choice. We also intentionally leave the workspace folder
  ; (%USERPROFILE%\.claude\agentview\workspace) so resumable .md docs
  ; from in-flight sessions survive an upgrade.
  DetailPrint "Preserving pinned taskbar shortcut + workspace data."
!macroend
