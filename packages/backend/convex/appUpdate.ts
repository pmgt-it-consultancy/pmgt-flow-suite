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
  args: { currentVersion: v.string(), variant: v.string() },
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

    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (response.status === 404) {
      return { updateAvailable: false as const };
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const releases = await response.json();
    // Find the latest release matching the app's variant (staging or production)
    const variantSuffix = args.variant === "production" ? "-production" : "-staging";
    const matchingReleases = releases
      .filter(
        (r: { tag_name: string; assets: { name: string }[] }) =>
          r.tag_name.endsWith(variantSuffix) &&
          r.assets?.some((a: { name: string }) => a.name.endsWith(".apk")),
      )
      .sort((a: { tag_name: string }, b: { tag_name: string }) => {
        const va = a.tag_name.replace(/^v/, "").replace(/-(staging|production)$/, "");
        const vb = b.tag_name.replace(/^v/, "").replace(/-(staging|production)$/, "");
        return compareSemver(vb, va); // descending
      });
    const release = matchingReleases[0] ?? null;

    if (release) {
      console.log(
        "[checkForUpdate] release assets:",
        release.assets?.map((a: { name: string }) => a.name),
      );
    }

    if (!release) {
      console.log("[checkForUpdate] no matching release found, returning updateAvailable: false");
      return { updateAvailable: false as const };
    }

    // Strip "v" prefix and variant suffix to get the semver
    const latestVersion = release.tag_name.replace(/^v/, "").replace(/-(staging|production)$/, "");

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

    console.log("[getApkDownloadUrl] fetching:", args.assetUrl);

    const response = await fetch(args.assetUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/octet-stream",
      },
      redirect: "manual",
    });

    console.log("[getApkDownloadUrl] status:", response.status);

    const location = response.headers.get("Location");
    if (location) {
      return location;
    }

    // Some GitHub token types (fine-grained) don't redirect — follow automatically instead
    const followResponse = await fetch(args.assetUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/octet-stream",
      },
    });

    if (!followResponse.ok) {
      throw new Error(
        `GitHub asset download failed: ${followResponse.status} ${followResponse.statusText}`,
      );
    }

    // Return the final URL after redirects
    return followResponse.url;
  },
});
