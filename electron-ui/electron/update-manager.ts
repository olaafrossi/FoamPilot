import { EventEmitter } from "events";
import { app } from "electron";
import type { DockerManager } from "./docker-manager.ts";

export interface ContainerUpdateInfo {
  available: boolean;
  current: string;
  latest: string;
}

export interface AppUpdateInfo {
  available: boolean;
  current: string;
  latest: string;
  downloadUrl?: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
}

export class UpdateManager extends EventEmitter {
  private dockerManager: DockerManager;

  constructor(dockerManager: DockerManager) {
    super();
    this.dockerManager = dockerManager;
  }

  /** Fetch the latest release from GitHub. Shared by container and app update checks. */
  private async fetchLatestRelease(): Promise<GitHubRelease | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(
        "https://api.github.com/repos/olaafrossi/FoamPilot/releases/latest",
        {
          signal: controller.signal,
          headers: { Accept: "application/vnd.github.v3+json" },
        },
      );
      clearTimeout(timeout);

      if (!res.ok) return null;

      const data = await res.json();
      const tagName = data.tag_name as string | undefined;
      if (!tagName) return null;

      return { tag_name: tagName, html_url: data.html_url ?? "" };
    } catch {
      return null;
    }
  }

  /** Check for Electron app updates using electron-updater. Only runs when packaged. */
  checkForElectronUpdate(): void {
    if (!app.isPackaged) return;

    try {
      // Dynamic import so it doesn't fail in dev
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.on("update-available", (info: any) => {
        this.emit("electron-update-available", info);
      });

      autoUpdater.on("update-downloaded", (info: any) => {
        this.emit("electron-update-downloaded", info);
      });

      autoUpdater.checkForUpdatesAndNotify();
    } catch {
      // electron-updater not available (dev mode)
    }
  }

  /** Check for app updates with feedback. Works in both packaged and dev mode. */
  async checkForAppUpdate(): Promise<AppUpdateInfo | null> {
    const current = app.getVersion();

    if (app.isPackaged) {
      // Packaged: try electron-updater for real update + install capability
      try {
        const { autoUpdater } = require("electron-updater");
        const result = await autoUpdater.checkForUpdates();
        if (result?.updateInfo) {
          const latest = result.updateInfo.version;
          const isNewer = this.compareVersions(latest, current) > 0;
          return {
            available: isNewer,
            current,
            latest,
          };
        }
        return { available: false, current, latest: current };
      } catch {
        // Fall through to GitHub API check
      }
    }

    // Dev mode or packaged fallback: check GitHub API directly
    const release = await this.fetchLatestRelease();
    if (!release) return null;

    const latest = release.tag_name.replace(/^v/, "");
    const isNewer = this.compareVersions(latest, current) > 0;

    return {
      available: isNewer,
      current,
      latest,
      downloadUrl: release.html_url,
    };
  }

  /** Check GitHub Releases for a newer container image. */
  async checkForContainerUpdate(): Promise<ContainerUpdateInfo | null> {
    const release = await this.fetchLatestRelease();
    if (!release) return null;

    const latestTag = release.tag_name.replace(/^v/, "");
    const current = this.dockerManager.getStoredVersion() || "0.0.0";

    if (!latestTag) return null;

    const isNewer = this.compareVersions(latestTag, current) > 0;
    const info: ContainerUpdateInfo = {
      available: isNewer,
      current,
      latest: latestTag,
    };

    if (isNewer) {
      this.emit("container-update-available", info);
    }

    return info;
  }

  /** Apply a container update: update .env, pull, recreate. */
  async applyContainerUpdate(tag: string, onProgress?: (line: string) => void): Promise<void> {
    // Pull new image
    await this.dockerManager.pull(tag, onProgress);
    // Recreate container with new image
    await this.dockerManager.down();
    await this.dockerManager.up();
  }

  /** Simple semver comparison. Returns >0 if a > b, 0 if equal, <0 if a < b. */
  private compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }
}
