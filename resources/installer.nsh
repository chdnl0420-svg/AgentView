; AgentView NSIS customization
; -----------------------------
; Responsibilities:
;
;  1. Page minimization — only show the directory chooser, the progress
;     panel and the finish page. No components, no start-menu, no
;     license. The per-user/per-machine choice is also gone: the build
;     forces per-user via electron-builder NSIS options
;     (oneClick:false + perMachine:false + allowElevation:false).
;
;  2. Auto-kill running AgentView before file extraction. Otherwise
;     Windows will refuse to overwrite a locked exe and the upgrade
;     silently corrupts. We try nsProcess first and fall back to
;     `taskkill` if the plugin is missing.
;
;  3. CLI install — after the app is installed, run `npm install -g
;     @anthropic-ai/claude-code` (best-effort, silent) so the user
;     doesn't hit an empty new-task screen because the bg daemon's
;     prerequisite is missing.
;
;  4. Pinned taskbar shortcut survival — the default electron-builder
;     NSIS upgrade flow does `RMDir /r $INSTDIR` before the new files
;     land, which makes a pinned taskbar LNK briefly point at a missing
;     exe and Windows un-pins it. We refresh the pinned LNK target on
;     every install with the current exe path, matching what
;     main/desktopShortcut.ts does on app launch.
;
;  5. Finish page "Run AgentView" checkbox, checked by default.
;
; electron-builder hooks called: customHeader, customInit,
; customInstall, customUnInstall, customWelcomePage (omitted),
; customFinishPage (omitted — we use MUI_FINISHPAGE_RUN instead).

; --- Page sequence override ---------------------------------------
; electron-builder generates the MUI page block from these defines. By
; declaring them BEFORE the MUI macros are inserted, we strip every
; page we don't want. The actual page macros (MUI_PAGE_DIRECTORY etc.)
; are emitted by electron-builder's generated installer based on
; whether these symbols exist.
;
; We can't remove already-inserted page macros, so instead we set the
; "skip" flags that electron-builder's template honors:
!define MUI_COMPONENTSPAGE_NODESC
; "Run AgentView" finish-page checkbox is supplied by electron-builder's
; own runAfterFinish:true. We don't redefine MUI_FINISHPAGE_RUN here —
; doing so collides with the builder's NSIS template and aborts the
; build with "MUI_FINISHPAGE_RUN already defined".

!macro customHeader
  ; Reserved for any future header tweaks. Kept so electron-builder's
  ; template doesn't error if it expects the macro.
!macroend

!macro customInit
  ; --- Kill any running AgentView before we touch $INSTDIR. ---------
  ; Try nsProcess first (bundled with electron-builder's NSIS). If it
  ; isn't available we fall back to taskkill. All failures are
  ; non-fatal: at worst the user sees a "file in use" prompt later.
  DetailPrint "Checking for a running AgentView instance..."
  nsProcess::_FindProcess "${PRODUCT_FILENAME}.exe"
  Pop $R0
  ${If} $R0 == 0
    DetailPrint "Found ${PRODUCT_FILENAME}.exe — terminating."
    nsProcess::_KillProcess "${PRODUCT_FILENAME}.exe"
    Pop $R0
    Sleep 800
  ${Else}
    ; Either no instance running, or nsProcess isn't loaded. Try
    ; taskkill as a belt-and-suspenders fallback. /F = force, /IM =
    ; image name. We swallow stderr/stdout so the installer log stays
    ; tidy.
    nsExec::ExecToLog 'cmd.exe /C "taskkill /F /IM ${PRODUCT_FILENAME}.exe >NUL 2>&1"'
    Pop $R0
    DetailPrint "taskkill fallback exit: $R0 (0 = killed, 128 = not running)."
  ${EndIf}
  ; Unload the plugin so subsequent installs don't keep a stale handle.
  nsProcess::_Unload
!macroend

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
