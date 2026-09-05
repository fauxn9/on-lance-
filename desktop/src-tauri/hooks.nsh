; Raccourci sur le bureau.
;
; Tauri ne l'expose pas en option de configuration : on passe donc par les
; points d'entree que son modele NSIS prevoit. Le chemin est celui qu'utilise
; le modele lui-meme, ce qui evite un doublon si une version future le cree de
; son cote — CreateShortcut ecrase le meme fichier au lieu d'en ajouter un.
;
; Les quatre macros sont definies meme vides : le modele les insere toutes, et
; une macro manquante casse la compilation de l'installateur.

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend
