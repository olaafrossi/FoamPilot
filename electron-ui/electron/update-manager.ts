import { EventEmitter } from "events";
import { app } from "electron";
import { DockerManager } from "./docker-manager";

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

  /** Check for Electron app updates via electron-updater. Only runs when packaged. */
  checkForElectronUpdate(): void {
    if (!app.isPackaged) return;

    try {
      // Dynamic import so dev mode doesn't fail if electron-updater isn't installed
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = false;

      autoUpdater.on("update-available", (info: any) => {
        this.emit("electron-update-available", info);
      });

      autoUpdater.on("update-downloaded", (info: any) => {
        this.emit("electron-update-downloaded", info);
      });

      autoUpdater.checkForUpdatesAndNotify();
    } catch {
      // electron-updater not available in dev
    }
  }

  /** Check GitHub Releases for a newer container image. */
  async checkForContainerUpdate(): Promise<ContainerUpdateInfo | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(
        "https://api.github.com/repos/olaafrossi/FoamPilot/releases/latest",
        {
          signal: controller.signal,
          headers: { Accept: "application/vnd.github.v3+json" },
        },
      );
      clearTimeout(timer);

      if (!res.ok) return null;

      const release = await res.json();
      const latestTag: string = release.tag_name?.replace(/^v/, "") ?? "";
      if (!latestTag) return null;

      const currentConfig = this.dockerManager.readEnvFile();
      const current = currentConfig.foampilotVersion;

      // "latest" always counts as needing update if a semver release exists
      const available =
        current === "latest" || this.isNewer(latestTag, current);

      const info: ContainerUpdateInfo = { available, current, latest: latestTag };

      if (available) {
        this.emit("container-update-available", info);
      }

      return info;
    } catch {
      // Network error, API rate limit, etc. — fail silently
      return null;
    }
  }

  /** Pull new container image and restart with the new tag. Yields progress lines. */
  async *applyContainerUpdate(tag: string): AsyncIterable<string> {
    // Update .env with new tag
    const cfg = this.dockerManager.readEnvFile();
    cfg.foampilotVersion = tag;
    await this.dockerManager.writeEnvFile(cfg);

    // Pull new image
    yield "Pulling new container image...";
    for await (const line of this.dockerManager.pull(tag)) {
      yield line;
    }

    // Recreate container
    yield "Stopping current container...";
    await this.dockerManager.down();

    yield "Starting updated container...";
    await this.dockerManager.up();

    yield "Update complete.";
  }

  /** Simple semver comparison: returns true if latest > current. */
  private isNewer(latest: string, current: string): boolean {
    const parse = (v: string) =>
      v
        .split(".")
        .map((n) => parseInt(n, 10) || 0);

    const l = parse(latest);
    const c = parse(current);

    for (let i = 0; i < Math.max(l.length, c.length); i++) {
      const lv = l[i] ?? 0;
      const cv = c[i] ?? 0;
      if (lv > cv) return true;
      if (lv < cv) return false;
    }
    return false;
  }
}
