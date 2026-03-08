import { vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name) => {
      if (name === 'userData') return '/tmp/snip-test-config';
      if (name === 'documents') return '/tmp/snip-test-documents';
      return '/tmp';
    }),
    isPackaged: false,
    quit: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workAreaSize: { width: 1920, height: 1080 },
    })),
  },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn(), on: vi.fn() })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  nativeImage: { createFromDataURL: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  clipboard: { writeImage: vi.fn() },
  systemPreferences: {},
  desktopCapturer: {},
}));
