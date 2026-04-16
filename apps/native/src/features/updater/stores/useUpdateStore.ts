import {
  completeHandler,
  createDownloadTask,
  type DownloadTask,
  directories,
} from "@kesha-antonov/react-native-background-downloader";
import Constants from "expo-constants";
import { getContentUriAsync } from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Notifications from "expo-notifications";
import { create } from "zustand";

export type UpdateInfo = {
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string;
  isForced: boolean;
};

export type DownloadStatus = "idle" | "downloading" | "completed" | "failed";

interface UpdateStore {
  // State
  updateInfo: UpdateInfo | null;
  dialogDismissed: boolean;
  downloadStatus: DownloadStatus;
  downloadProgress: number;
  isChecking: boolean;
  lastCheckedAt: number | null;
  error: string | null;
  apkFileUri: string | null;
  downloadTask: DownloadTask | null;

  // Actions
  checkForUpdate: (
    checkAction: (args: { currentVersion: string; variant: string }) => Promise<any>,
  ) => Promise<void>;

  startDownload: (getUrlAction: (args: { assetUrl: string }) => Promise<string>) => Promise<void>;

  installUpdate: () => Promise<void>;
  dismiss: () => void;
  reset: () => void;
}

const getCurrentVersion = () => Constants.expoConfig?.version ?? "0.0.0";
const getAppVariant = () => (Constants.expoConfig?.extra?.appVariant as string) ?? "production";

const APK_FILENAME = "update.apk";
const PROGRESS_NOTIFICATION_ID = "download-progress";

function notify(title: string, body: string, data?: Record<string, string>) {
  Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: null,
  }).catch((e) => console.warn("Notification failed:", e));
}

function notifyProgress(pct: number, version: string) {
  const percent = Math.round(pct * 100);
  Notifications.scheduleNotificationAsync({
    identifier: PROGRESS_NOTIFICATION_ID,
    content: {
      title: "Downloading update",
      body: `v${version} — ${percent}%`,
      data: { type: "update-download" },
      sticky: true,
    },
    trigger: null,
  }).catch((e) => console.warn("Progress notification failed:", e));
}

function dismissProgressNotification() {
  Notifications.dismissNotificationAsync(PROGRESS_NOTIFICATION_ID).catch(() => {});
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  updateInfo: null,
  dialogDismissed: false,
  downloadStatus: "idle",
  downloadProgress: 0,
  isChecking: false,
  lastCheckedAt: null,
  error: null,
  apkFileUri: null,
  downloadTask: null,

  checkForUpdate: async (checkAction) => {
    if (get().isChecking) return;
    set({ isChecking: true, error: null });
    try {
      const currentVersion = getCurrentVersion();
      const variant = getAppVariant();
      const result = await checkAction({ currentVersion, variant });
      if (result.updateAvailable) {
        const prev = get().updateInfo;
        const isNewVersion = prev?.latestVersion !== result.latestVersion;
        set({
          updateInfo: {
            latestVersion: result.latestVersion,
            downloadUrl: result.downloadUrl,
            releaseNotes: result.releaseNotes,
            isForced: result.isForced,
          },
          ...(isNewVersion ? { dialogDismissed: false } : {}),
        });
        if (!result.isForced) {
          notify("Update Available", `v${result.latestVersion} is available.`, {
            type: "update-available",
          });
        }
      } else {
        set({ updateInfo: null });
      }
      set({ lastCheckedAt: Date.now() });
    } catch (e: any) {
      set({ error: e.message ?? "Update check failed" });
    } finally {
      set({ isChecking: false });
    }
  },

  startDownload: async (getUrlAction) => {
    const { updateInfo, downloadTask: existingTask } = get();
    if (!updateInfo) return;

    // Stop any existing download
    if (existingTask) {
      existingTask.stop();
    }

    set({ downloadStatus: "downloading", downloadProgress: 0, error: null });

    try {
      // Get temporary download URL from Convex proxy
      const url = await getUrlAction({ assetUrl: updateInfo.downloadUrl });

      const destination = directories.documents + "/" + APK_FILENAME;

      const task = createDownloadTask({
        id: "app-update",
        url,
        destination,
      });

      set({ downloadTask: task });

      let lastNotifiedPct = -1;

      notifyProgress(0, updateInfo.latestVersion);

      task
        .begin(({ expectedBytes }) => {
          if (__DEV__) console.log(`Download started, expected: ${expectedBytes} bytes`);
        })
        .progress(({ bytesDownloaded, bytesTotal }) => {
          const pct = bytesTotal > 0 ? bytesDownloaded / bytesTotal : 0;
          set({ downloadProgress: pct });

          // Update notification every 5%
          const rounded = Math.floor(pct * 20) * 5;
          if (rounded > lastNotifiedPct) {
            lastNotifiedPct = rounded;
            notifyProgress(pct, updateInfo.latestVersion);
          }
        })
        .done(() => {
          const fileUri = "file://" + destination;
          set({
            downloadStatus: "completed",
            downloadProgress: 1,
            apkFileUri: fileUri,
            downloadTask: null,
          });

          completeHandler("app-update");
          dismissProgressNotification();

          notify(
            "Update ready to install",
            `v${updateInfo.latestVersion} downloaded. Tap to install.`,
            { type: "update-install" },
          );
        })
        .error(({ error: downloadError }) => {
          set({
            downloadStatus: "failed",
            error: downloadError ?? "Download failed",
            downloadTask: null,
          });

          dismissProgressNotification();
          notify("Update download failed", "Tap to retry.", {
            type: "update-failed",
          });
        });

      task.start();
    } catch (e: any) {
      set({
        downloadStatus: "failed",
        error: e.message ?? "Download failed",
        downloadTask: null,
      });
    }
  },

  installUpdate: async () => {
    const { apkFileUri } = get();
    if (!apkFileUri) return;

    try {
      const contentUri = await getContentUriAsync(apkFileUri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: "application/vnd.android.package-archive",
      });
    } catch (e: any) {
      console.error("Install failed:", e);
      set({ error: e.message ?? "Install failed" });
    }
  },

  dismiss: () => {
    const { updateInfo } = get();
    if (updateInfo?.isForced) return;
    set({ dialogDismissed: true });
  },

  reset: () => {
    const { downloadTask } = get();
    if (downloadTask) downloadTask.stop();
    set({
      updateInfo: null,
      dialogDismissed: false,
      downloadStatus: "idle",
      downloadProgress: 0,
      isChecking: false,
      error: null,
      apkFileUri: null,
      downloadTask: null,
    });
  },
}));
