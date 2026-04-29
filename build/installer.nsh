; installer.nsh — Custom NSIS hooks for Enterprise Agent
; Included by electron-builder via nsis.include in electron-builder.yml
;
; preInit runs at the beginning of NSIS .OnInit — before uninstall/replace steps.
; HKLM Run + startup can respawn the agent while the updater runs; taskkill fixes
; "Failed to uninstall old application files ... : 2".
;
; customInstall runs AFTER the main installer finishes.
; customUnInstall runs DURING uninstallation before files are removed.

!macro preInit
  ; Always exit 0 so NSIS does not abort when no process was running
  ExecWait 'cmd.exe /c taskkill /F /IM EnterpriseAgent.exe /T >nul 2>&1 & exit /b 0'
  Sleep 4000
!macroend

!macro customInstall
  ; Write to HKLM so the agent auto-starts for ALL users on this machine,
  ; not just the account that ran the installer.
  ; --hidden suppresses the UI on startup; the agent runs silently in the tray.
  ; The packaged app skips adding an HKCU login item on Windows (see registerRunAtStartup in main)
  ; so this HKLM key is the single autostart mechanism for packaged installs.
  WriteRegStr HKLM \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" \
    "EnterpriseAgent" \
    '"$INSTDIR\EnterpriseAgent.exe" --hidden'

  ; Prevent users from uninstalling via Add/Remove Programs by hiding the entry.
  ; IT can still uninstall by running the installer with /uninstall or via Intune.
  WriteRegDWORD HKLM \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{${UNINSTALL_APP_KEY}}" \
    "SystemComponent" 1
!macroend

!macro customUnInstall
  ; Clean up the machine-wide startup registry entry on uninstall.
  DeleteRegValue HKLM \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" \
    "EnterpriseAgent"
!macroend
