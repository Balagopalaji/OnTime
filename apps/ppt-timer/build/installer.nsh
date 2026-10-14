; Custom NSIS hooks for the Downstage PPT Video Timer installer (ISSUE-002 S6d).
;
; electron-builder's NSIS target ignores the top-level `protocols` config (only AppX, mac and
; Linux read it), and the app never writes the OS registry at runtime, so the per-user install
; registers the publisher-approval callback scheme itself. HKCU keeps it per-user (no elevation),
; matching `perMachine: false`. The scheme must stay in sync with CALLBACK_SCHEME in
; src/main/remote-share.ts (asserted by src/main/builder-config.test.ts).

!macro customInstall
  WriteRegStr HKCU "Software\Classes\downstage-ppt-timer" "" "URL:Downstage PPT Timer"
  WriteRegStr HKCU "Software\Classes\downstage-ppt-timer" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\downstage-ppt-timer\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\downstage-ppt-timer\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\downstage-ppt-timer"
!macroend
