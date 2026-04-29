; installer.nsh — Custom NSIS hooks for Enterprise Agent
; Included by electron-builder via nsis.include in electron-builder.yml
;
; customInstall runs AFTER the main installer finishes.
; customUnInstall runs DURING uninstallation before files are removed.

!macro customInstall
  ; Write to HKLM so the agent auto-starts for ALL users on this machine,
  ; not just the account that ran the installer.
  ; --hidden suppresses the UI on startup; the agent runs silently in the tray.
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
