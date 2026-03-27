import { EventEmitter } from "events";
import { app } from "electron";
import type { DockerManager } from "./docker-manager";

export interface ContainerUpdateInfo {
  available: boolean;
  current: string;
  latest: string;
}

export class UpdateManager extends EventEmitter {
  private dockerManager: DockerManager;

  constructor(dockerManager: DockerManager) {
    super();
    this.dockerManager = dockerManager;
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

  /** Check GitHub Releases for a newer container image. */
  async checkForContainerUpdate(): Promise<ContainerUpdateInfo | null> {
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
      const latestTag = (data.tag_name as string)?.replace(/^v/, "") ?? "";
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
    } catch {
      return null;
    }
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
