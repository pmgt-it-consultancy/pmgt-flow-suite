"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export const checkForUpdate = action({
  args: { currentVersion: v.string() },
  returns: v.union(
    v.object({
      updateAvailable: v.literal(true),
      latestVersion: v.string(),
      downloadUrl: v.string(),
      releaseNotes: v.string(),
      isForced: v.boolean(),
    }),
    v.object({
      updateAvailable: v.literal(false),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | {
        updateAvailable: true;
        latestVersion: string;
        downloadUrl: string;
        releaseNotes: string;
        isForced: boolean;
      }
    | { updateAvailable: false }
  > => {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;

    if (!token || !repo) {
      throw new Error("GITHUB_TOKEN and GITHUB_REPO environment variables are required");
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const release = await response.json();
    const latestVersion = release.tag_name.replace(/^v/, "");

    if (compareSemver(latestVersion, args.currentVersion) <= 0) {
      return { updateAvailable: false as const };
    }

    const apkAsset = release.assets?.find((asset: { name: string }) => asset.name.endsWith(".apk"));

    if (!apkAsset) {
      throw new Error("No APK asset found in the latest release");
    }

    const minRequired: { value: string } | null = await ctx.runQuery(
      internal.appConfig.getMinRequiredVersion,
      {},
    );
    const isForced: boolean = minRequired
      ? compareSemver(minRequired.value, args.currentVersion) > 0
      : false;

    return {
      updateAvailable: true as const,
      latestVersion,
      downloadUrl: apkAsset.url,
      releaseNotes: release.body ?? "",
      isForced,
    };
  },
});

export const getApkDownloadUrl = action({
  args: { assetUrl: v.string() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    const response = await fetch(args.assetUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/octet-stream",
      },
      redirect: "manual",
    });

    const location = response.headers.get("Location");
    if (!location) {
      throw new Error("No redirect Location header received from GitHub");
    }

    return location;
  },
});
