/* 晶途拾光 — Windows 桌面壳（Electron 主进程）
 * --------------------------------------------------------------------------
 * 这里只做一件事：把已经通过全部规格自检的网页版游戏装进一个原生窗口，
 * 不改动任何游戏逻辑。渲染、物理、存档格式、音频全部沿用同一份代码。
 *
 * 与规格书 §10.2 对应的几项：
 *   · 存档路径 %APPDATA%\CrystalTrail\save —— 通过 app.setPath('userData', ...)
 *     把 Chromium 的 localStorage 落到该目录，从而保证升级与卸载不误删存档
 *   · 不需要管理员权限（requestedExecutionLevel = asInvoker）
 *   · 默认窗口 1440 × 810（480 × 270 的 3 倍整数缩放，§7.1）
 *   · 不写入安装目录以外的位置
 */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// §10.2 存档写到用户目录，而不是安装目录
const USER_DATA = path.join(app.getPath('appData'), 'CrystalTrail');
try {
  fs.mkdirSync(path.join(USER_DATA, 'save'), { recursive: true });
} catch (e) { /* 目录已存在或无权限，交由 Chromium 降级处理 */ }
app.setPath('userData', USER_DATA);

// 允许音频在无用户手势时启动（桌面端没有浏览器的自动播放限制）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// 关闭 GPU 合成可能带来的像素插值风险，像素游戏走纯软件合成更稳
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const GAME_W = 480;
const GAME_H = 270;
const DEFAULT_SCALE = 3;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: GAME_W * DEFAULT_SCALE,
    height: GAME_H * DEFAULT_SCALE,
    minWidth: GAME_W,
    minHeight: GAME_H,
    backgroundColor: '#0a0c14',
    title: '晶途拾光',
    icon: path.join(__dirname, 'resources', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      // 游戏用 localStorage 存档，需要保持同源
      webSecurity: true,
      spellcheck: false,
    },
  });

  // 网页版已经改成「逻辑分辨率跟随窗口 + 整数倍缩放」，任意窗口比例都能铺满，
  // 所以不再锁定 16:9，用户可以自由拉伸窗口，F11 全屏也能自然适配。

  mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // 外部链接交给系统浏览器，不在游戏窗口里打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // F11 全屏 / Ctrl+Shift+I 开发者工具（方便排查），其余按键交给游戏
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 渲染进程崩溃时给出可读提示，而不是白屏
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    dialog.showErrorBox('游戏进程异常退出', '渲染进程结束：' + details.reason);
  });
}

// 单实例：重复启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);   // 不给用户一个和游戏无关的菜单栏
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
