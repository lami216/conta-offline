Unicode true
Name "Conta Offline"
OutFile "..\release\Conta-Offline-Setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\Conta Offline"
RequestExecutionLevel user
SetCompressor zlib
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
Section "Conta Offline"
  SetOutPath "$INSTDIR"
  File /r "..\release\win-unpacked\*"
  WriteUninstaller "$INSTDIR\Uninstall Conta Offline.exe"
  CreateDirectory "$SMPROGRAMS\Conta Offline"
  CreateShortcut "$SMPROGRAMS\Conta Offline\Conta Offline.lnk" "$INSTDIR\Conta Offline.exe"
  CreateShortcut "$SMPROGRAMS\Conta Offline\Uninstall.lnk" "$INSTDIR\Uninstall Conta Offline.exe"
  CreateShortcut "$DESKTOP\Conta Offline.lnk" "$INSTDIR\Conta Offline.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Conta Offline" "DisplayName" "Conta Offline"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Conta Offline" "UninstallString" '"$INSTDIR\Uninstall Conta Offline.exe"'
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\Conta Offline.lnk"
  RMDir /r "$SMPROGRAMS\Conta Offline"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Conta Offline"
  ; Deliberately preserve $LOCALAPPDATA\Conta Offline user data.
SectionEnd
