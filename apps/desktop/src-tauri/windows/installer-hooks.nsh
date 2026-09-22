; Installation never edits AI configuration. Only an explicit app action connects.
!macro NSIS_HOOK_PREINSTALL
  ; Keep the handle open until process exit, including silent/Store installs.
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\AutoPetsInstaller") p .r0 ?e'
  Pop $1
  ${If} $0 == 0
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $1 == 183
    SetErrorLevel 1618
    Quit
  ${EndIf}
!macroend

; Remove only recorded AutoPets-owned hooks before removing bundled helpers.
!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri's signed update flow must retain the user's existing connection.
  ${If} $UpdateMode = 1
    Goto autopets_cleanup_done
  ${EndIf}
  IfFileExists "$INSTDIR\connector\runtime\node.exe" 0 autopets_cleanup_done
  nsExec::ExecToStack /TIMEOUT=30000 '"$INSTDIR\connector\runtime\node.exe" "$INSTDIR\connector\integrations\codex\bootstrap\start.mjs" --disconnect'
  Pop $0
  Pop $1
  StrCmp $0 "0" autopets_cleanup_done
  ; Keep helpers available for repair if owned configuration cannot be removed.
  IfSilent +2
    MessageBox MB_ICONSTOP|MB_OK "AutoPets could not remove its AI connection. Open AutoPets, disconnect, then retry removal."
  SetErrorLevel 2
  Quit
  ; App records are retained independently of connection removal.
autopets_cleanup_done:
!macroend
