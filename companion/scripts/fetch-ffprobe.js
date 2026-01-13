#!/usr/bin/env node
/**
 * Fetches an LGPL-only ffprobe binary for the current platform and places it at bin/ffprobe.
 * Sources default to BtbN FFmpeg lgpl builds. You can override URLs via environment variables:
 *   FFPROBE_URL_MAC, FFPROBE_URL_WIN, FFPROBE_URL_LINUX
 *
 * This script uses curl + tar to avoid extra deps. Ensure curl and tar are available.
 * On Windows (PowerShell), `tar` is bundled; curl is available as `curl.exe`.
 *
 * License note: verify the downloaded artifact remains LGPL-only before shipping.
 */

const { execFileSync } = require("node:child_process");
const {
  mkdtempSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  createWriteStream,
  statSync,
  writeFileSync,
  readdirSync,
} = require("node:fs");
const { spawnSync } = require("node:child_process");
const https = require("node:https");
const { tmpdir } = require("node:os");
const { join, resolve, basename } = require("node:path");

const platform = process.platform;
const arch = process.arch;

const macArchUrl = arch === "arm64"
  ? "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/snapshot/ffprobe.zip"
  : "https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/snapshot/ffprobe.zip";

const urlCandidates = {
  darwin:
    process.env.FFPROBE_URL_MAC?.split(",") ?? [
      // Arch-specific first choice (martin-riedl snapshot)
      macArchUrl,
      // BtbN macOS LGPL builds (include versioned fallbacks because "master" assets can be removed)
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n7.1-latest-macos64-lgpl-shared.tar.xz",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n7.1-latest-macos64-lgpl-shared.zip",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n6.1-latest-macos64-lgpl-shared.tar.xz",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n6.1-latest-macos64-lgpl-shared.zip",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n7.1-latest-macos64-lgpl-shared.7z",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n6.1-latest-macos64-lgpl-shared.7z",
    ],
  win32:
    process.env.FFPROBE_URL_WIN?.split(",") ?? [
      // BtbN Windows LGPL builds
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n7.1-latest-win64-lgpl-shared.zip",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n6.1-latest-win64-lgpl-shared.zip",
    ],
  linux:
    process.env.FFPROBE_URL_LINUX?.split(",") ?? [
      // BtbN Linux LGPL builds
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n7.1-latest-linux64-lgpl-shared.tar.xz",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n6.1-latest-linux64-lgpl-shared.tar.xz",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n7.1-latest-linux64-lgpl-shared.tar.gz",
      "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n6.1-latest-linux64-lgpl-shared.tar.gz",
    ],
};

function fail(msg) {
  console.error(`[fetch-ffprobe] ${msg}`);
  process.exit(1);
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function exec(cmd, args, cwd) {
  execFileSync(cmd, args, { stdio: "inherit", cwd });
}

function download(url, dest) {
  console.log(`[fetch-ffprobe] Downloading ${url}`);
  return new Promise((resolvePromise, rejectPromise) => {
    const seen = new Set();
    function get(currentUrl, redirects = 0) {
      if (redirects > 5) return rejectPromise(new Error("Too many redirects"));
      const req = https.get(
        currentUrl,
        {
          headers: {
            "User-Agent": "ontime-fetch-ffprobe",
            Accept: "application/octet-stream",
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const next = new URL(res.headers.location, currentUrl).toString();
            if (seen.has(next)) return rejectPromise(new Error("Redirect loop detected"));
            seen.add(next);
            res.resume();
            return get(next, redirects + 1);
          }
          if (res.statusCode && res.statusCode >= 400) {
            return rejectPromise(new Error(`Download failed with status ${res.statusCode}`));
          }
          const file = createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => file.close(resolvePromise));
          file.on("error", rejectPromise);
        }
      );
      req.on("error", rejectPromise);
    }
    get(url);
  });
}

async function downloadFirst(urls, dest) {
  let lastErr;
  for (const url of urls) {
    try {
      await download(url, dest);
      return { url };
    } catch (err) {
      lastErr = err;
      console.warn(`[fetch-ffprobe] Failed ${url}: ${err.message || err}`);
    }
  }
  if (lastErr) throw lastErr;
  throw new Error("No URLs provided");
}

function extract(archivePath, workDir) {
  if (archivePath.endsWith(".tar.xz")) {
    exec("tar", ["-xf", archivePath], workDir);
  } else if (archivePath.endsWith(".zip")) {
    // Prefer built-in macOS ditto to avoid unzip buffering issues
    if (platform === "darwin") {
      exec("ditto", ["-x", "-k", archivePath, workDir]);
    } else {
      exec(platform === "win32" ? "tar" : "unzip", ["-xf", archivePath], workDir);
    }
  } else if (archivePath.endsWith(".7z")) {
    exec("7z", ["x", archivePath], workDir);
  } else {
    fail(`Unsupported archive format: ${archivePath}`);
  }
}

function findBinaryDeep(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isFile()) {
      if (entry.name === "ffprobe" || entry.name === "ffprobe.exe") return full;
    } else if (entry.isDirectory()) {
      const found = findBinaryDeep(full);
      if (found) return found;
    }
  }
  return undefined;
}

function findBinary(root) {
  const candidates = [
    join(root, "ffprobe"),
    join(root, "bin", "ffprobe"),
    join(root, "ffmpeg-master-latest-macos64-lgpl-shared", "bin", "ffprobe"),
    join(root, "ffmpeg-master-latest-linux64-lgpl-shared", "bin", "ffprobe"),
    join(root, "ffmpeg-master-latest-win64-lgpl-shared", "bin", "ffprobe.exe"),
    join(root, "ffprobe.app", "Contents", "MacOS", "ffprobe"),
    join(root, "ffprobe"), // after unzip may be flat
    join(root, "bin", "ffprobe.exe"),
  ];
  const direct = candidates.find((p) => existsSync(p));
  if (direct) return direct;
  return findBinaryDeep(root);
}

function extractSingleFromZip(archivePath, destPath) {
  // Try unzip first (may be missing or constrained), fallback to JS zip parsing if unzip fails.
  let list;
  try {
    const res = spawnSync("unzip", ["-Z1", archivePath], { encoding: "utf8" });
    if (res.error) throw res.error;
    list = res.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    list = [];
  }

  let entry =
    list.find((n) => n.endsWith("ffprobe") || n.endsWith("ffprobe.exe")) ||
    list.find((n) => n.toLowerCase().includes("ffprobe"));

  if (!entry) {
    // Fallback: use JS zip reader to locate entry
    const { unzip } = require("zlib");
    // Simple manual scan using unzip -p streaming via spawn (less memory than unzip -p to stdout)
    const probe = spawnSync("unzip", ["-Z1", archivePath], { encoding: "utf8" });
    if (probe.error) fail(`unzip not available: ${probe.error.message}`);
    const names = probe.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    entry =
      names.find((n) => n.endsWith("ffprobe") || n.endsWith("ffprobe.exe")) ||
      names.find((n) => n.toLowerCase().includes("ffprobe"));
  }

  if (!entry) {
    fail("ffprobe entry not found inside zip");
  }

  const res = spawnSync("unzip", ["-p", archivePath, entry], { encoding: "buffer" });
  if (res.error) fail(`unzip failed: ${res.error.message}`);
  if (res.status !== 0) fail(`unzip failed with code ${res.status}`);
  writeFileSync(destPath, res.stdout, { mode: 0o755 });
}

function main() {
  if (!["darwin", "win32", "linux"].includes(platform)) {
    fail(`Unsupported platform: ${platform}`);
  }
  if (!["x64", "arm64"].includes(arch)) {
    console.warn(`[fetch-ffprobe] Unusual arch '${arch}', continuing but binary may not match.`);
  }

  const urls = urlCandidates[platform];
  if (!urls || urls.length === 0) fail("No download URL configured for this platform.");

  const tempDir = mkdtempSync(join(tmpdir(), "ffprobe-"));
  const archiveName = basename(urls[0].split("?")[0] || "ffprobe-archive");
  const archivePath = join(tempDir, archiveName);
  downloadFirst(urls, archivePath)
    .then(() => {
      const size = statSync(archivePath).size;
      if (size < 100000) {
        fail(
          `Downloaded file is too small (${size} bytes). The source may have returned an HTML error page. Override with FFPROBE_URL_* or retry.`
        );
      }

      extract(archivePath, tempDir);

      const found = findBinary(tempDir);
      if (!found) fail("ffprobe binary not found after extraction.");

      const destDir = resolve(__dirname, "..", "bin");
      ensureDir(destDir);
      const destPath = join(destDir, platform === "win32" ? "ffprobe.exe" : "ffprobe");
      renameSync(found, destPath);
      if (platform !== "win32") {
        exec("chmod", ["755", destPath]);
      }

      console.log(`[fetch-ffprobe] ffprobe placed at ${destPath}`);
      rmSync(tempDir, { recursive: true, force: true });
    })
    .catch((err) => {
      fail(err.message || String(err));
    });
}

main();

