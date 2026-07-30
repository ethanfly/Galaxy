; NSIS template hooks for Galaxy Terminal.
; Extends Tauri's default NSIS template with Explorer "Open here" context
; menu entries (directory / directory background / drive) and unregisters
; them on uninstall. Install mode is per-user (HKCU), no admin required.

!include "FileFunc.nsh"

!define GT_APP_EXE "$INSTDIR\galaxy-terminal.exe"

!macro NSIS_HOOK_PREINSTALL
  ; Close running instance before upgrade to avoid file locks.
  nsExec::ExecToStack 'taskkill /F /IM galaxy-terminal.exe /FI "WINDOWTITLE eq Galaxy Terminal"'
  Pop $0
  Pop $1
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; --- Explorer context menu: open directory in Galaxy Terminal ---
  WriteRegStr HKCU "Software\Classes\Directory\shell\GalaxyTerminal" "" "在此处打开银河终端"
  WriteRegStr HKCU "Software\Classes\Directory\shell\GalaxyTerminal" "Icon" '"$INSTDIR\galaxy-terminal.exe"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\GalaxyTerminal\command" "" '"$INSTDIR\galaxy-terminal.exe" --open-here "%1"'

  ; --- Explorer context menu: right click on empty area inside a folder ---
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\GalaxyTerminal" "" "在此处打开银河终端"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\GalaxyTerminal" "Icon" '"$INSTDIR\galaxy-terminal.exe"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\GalaxyTerminal\command" "" '"$INSTDIR\galaxy-terminal.exe" --open-here "%V"'

  ; --- Explorer context menu: drives ---
  WriteRegStr HKCU "Software\Classes\Drive\shell\GalaxyTerminal" "" "在此处打开银河终端"
  WriteRegStr HKCU "Software\Classes\Drive\shell\GalaxyTerminal" "Icon" '"$INSTDIR\galaxy-terminal.exe"'
  WriteRegStr HKCU "Software\Classes\Drive\shell\GalaxyTerminal\command" "" '"$INSTDIR\galaxy-terminal.exe" --open-here "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\GalaxyTerminal"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\GalaxyTerminal"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\GalaxyTerminal"
!macroend
