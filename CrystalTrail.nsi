/* 晶途拾光 — Windows 安装程序（NSIS 3）
 * --------------------------------------------------------------------------
 * 为什么自己写脚本：electron-builder 的 NSIS 流程会先用一个「生成卸载器」的
 * 半成品安装包在构建机上跑一遍，再从里面抽卸载程序。这一步在本机反复返回
 * 退出码 2，导致最终安装包只有 166 KB。
 * 这里改为标准 NSIS 做法 —— WriteUninstaller 在安装时生成卸载器，构建过程
 * 只编译、不执行任何产物。
 *
 * 安装范围：当前用户（$LOCALAPPDATA\Programs），不需要管理员权限。
 * 存档位于 %APPDATA%\CrystalTrail，卸载时有意保留。
 */

Unicode true

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define APP_NAME        "晶途拾光"
!define APP_NAME_EN     "Crystal Trail"
!define APP_EXE         "晶途拾光.exe"
!define APP_ID          "CrystalTrail"
!define APP_VERSION     "1.0.0"
!define APP_PUBLISHER   "晶途拾光"
!define APP_URL         "https://crystalltrail.local"

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME} ${APP_VERSION}"
BrandingText "${APP_NAME} ${APP_VERSION}"
OutFile "${OUT_DIR}\CrystalTrail-Setup-${APP_VERSION}.exe"

InstallDir "$LOCALAPPDATA\Programs\${APP_ID}"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallDir"

RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName"     "${APP_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion"     "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey /LANG=2052 "LegalCopyright"  "Copyright © 2026 ${APP_PUBLISHER}"

!define MUI_ICON   "${RES_DIR}\icon.ico"
!define MUI_UNICON "${RES_DIR}\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APP_NAME} ${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "把安静的像素旅途装到这台电脑上。$\r$\n$\r$\n安装到当前用户目录，不需要管理员权限；存档会写在用户目录里，卸载时保留。"
!define MUI_FINISHPAGE_TITLE "装好了"
!define MUI_FINISHPAGE_TEXT "${APP_NAME} 已经安装完成。$\r$\n$\r$\n方向键 / WASD 移动，空格跳跃，E 交互，Esc 暂停；F11 全屏。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "现在开始旅途"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; ------------------------------------------------------------------ 安装
Section "游戏文件" SecMain
  SectionIn RO

  ; 关掉正在运行的实例，避免文件占用
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Sleep 400

  SetOutPath "$INSTDIR"
  File /r "${STAGE_DIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  WriteRegStr HKCU "Software\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\${APP_ID}" "Version" "${APP_VERSION}"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName_en"  "${APP_NAME_EN}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout"    "${APP_URL}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

; ------------------------------------------------------------------ 卸载
Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Sleep 400

  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP_ID}"

  ; 存档在 %APPDATA%\CrystalTrail，有意保留：
  ; 重装后进度还在，这也是 §10.2 的要求。
SectionEnd

Function .onInit
  ; 已经装过就默认定位到原目录
  ReadRegStr $0 HKCU "Software\${APP_ID}" "InstallDir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd
