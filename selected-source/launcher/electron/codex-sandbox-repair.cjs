const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const SETUP_HELPER = "codex-windows-sandbox-setup.exe";
const COMMAND_RUNNER = "codex-command-runner.exe";
const SMOKE_TIMEOUT_MS = 45_000;

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex").toUpperCase();
}

function uniquePaths(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;

    const resolved = path.resolve(value.trim());
    const key = process.platform === "win32"
      ? resolved.toLowerCase()
      : resolved;

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(resolved);
  }

  return result;
}

function locateCodexExecutable() {
  const env = process.env;
  const localAppData = env.LOCALAPPDATA || "";

  const candidates = [
    env.CODEX_EXE,
    localAppData
      ? path.join(
          localAppData,
          "Programs",
          "OpenAI",
          "Codex",
          "bin",
          "codex.exe",
        )
      : null,
    localAppData
      ? path.join(
          localAppData,
          "OpenAI",
          "Codex",
          "bin",
          "codex.exe",
        )
      : null,
  ];

  const windowsDir =
    env.WINDIR ||
    env.SystemRoot ||
    "C:\\Windows";

  const whereExe =
    path.join(
      windowsDir,
      "System32",
      "where.exe",
    );

  if (isFile(whereExe)) {
    const found = spawnSync(
      whereExe,
      ["codex.exe"],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      },
    );

    if (!found.error && found.status === 0) {
      for (const line of String(found.stdout || "").split(/\r?\n/)) {
        if (line.trim()) candidates.push(line.trim());
      }
    }
  }

  for (const candidate of uniquePaths(candidates)) {
    if (isFile(candidate)) return candidate;
  }

  throw new Error(
    "Could not locate codex.exe. "
    + "Expected the OpenAI Codex installation under LOCALAPPDATA "
    + "or an executable discoverable through where.exe.",
  );
}

function readCodexVersion(codexExe) {
  const result = spawnSync(
    codexExe,
    ["--version"],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    },
  );

  if (result.error) {
    throw new Error(
      `Failed to read Codex version: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `codex --version exited with ${result.status}`,
    );
  }

  const text =
    `${result.stdout || ""}\n${result.stderr || ""}`;

  const match =
    text.match(
      /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/,
    );

  if (!match) {
    throw new Error(
      `Could not parse Codex version from: ${text.trim()}`,
    );
  }

  return match[1];
}

function architectureName() {
  if (process.arch === "x64") return "x86_64";
  if (process.arch === "arm64") return "aarch64";

  return null;
}

function locateCodexResources(codexHome, version) {
  const releasesRoot =
    path.join(
      codexHome,
      "packages",
      "standalone",
      "releases",
    );

  if (!fs.existsSync(releasesRoot)) {
    throw new Error(
      `Codex standalone releases directory is missing: ${releasesRoot}`,
    );
  }

  const architecture =
    architectureName();

  const preferredName =
    architecture
      ? `${version}-${architecture}-pc-windows-msvc`
      : null;

  const candidates =
    fs.readdirSync(
      releasesRoot,
      { withFileTypes: true },
    )
      .filter((entry) =>
        entry.isDirectory()
        && entry.name.startsWith(`${version}-`)
        && entry.name.includes("pc-windows-msvc"))
      .map((entry) => entry.name)
      .sort((left, right) => {
        if (left === preferredName) return -1;
        if (right === preferredName) return 1;
        return left.localeCompare(right);
      });

  for (const releaseName of candidates) {
    const resources =
      path.join(
        releasesRoot,
        releaseName,
        "codex-resources",
      );

    const setup =
      path.join(
        resources,
        SETUP_HELPER,
      );

    const runner =
      path.join(
        resources,
        COMMAND_RUNNER,
      );

    if (
      isFile(setup)
      && isFile(runner)
    ) {
      return {
        releaseName,
        resources,
        setup,
        runner,
      };
    }
  }

  throw new Error(
    `No matching Codex ${version} Windows codex-resources directory `
    + `with ${SETUP_HELPER} and ${COMMAND_RUNNER} was found.`,
  );
}

function copyVerified(
  source,
  destination,
  stamp,
) {
  const sourceHash =
    sha256(source);

  if (isFile(destination)) {
    const destinationHash =
      sha256(destination);

    if (destinationHash === sourceHash) {
      return {
        changed: false,
        destination,
        hash: sourceHash,
        backup: null,
      };
    }
  }

  fs.mkdirSync(
    path.dirname(destination),
    { recursive: true },
  );

  let backup = null;

  if (isFile(destination)) {
    backup =
      `${destination}.before-codex-web-gpt-repair-${stamp}`;

    fs.copyFileSync(
      destination,
      backup,
    );
  }

  try {
    fs.copyFileSync(
      source,
      destination,
    );

    const destinationHash =
      sha256(destination);

    if (destinationHash !== sourceHash) {
      throw new Error(
        `Hash mismatch after copying ${destination}`,
      );
    }
  } catch (error) {
    if (
      backup
      && isFile(backup)
    ) {
      fs.copyFileSync(
        backup,
        destination,
      );
    }

    throw error;
  }

  return {
    changed: true,
    destination,
    hash: sourceHash,
    backup,
  };
}

function smokeCodexWindowsSandbox(
  codexExe,
) {
  const windowsDir =
    process.env.WINDIR ||
    process.env.SystemRoot ||
    "C:\\Windows";

  const cmdExe =
    path.join(
      windowsDir,
      "System32",
      "cmd.exe",
    );

  if (!isFile(cmdExe)) {
    throw new Error(
      `Windows cmd.exe is missing: ${cmdExe}`,
    );
  }

  const marker =
    `CODEX_WINDOWS_SANDBOX_OK_${process.pid}_${Date.now()}`;

  const result =
    spawnSync(
      codexExe,
      [
        "-c",
        'windows.sandbox="elevated"',
        "sandbox",
        cmdExe,
        "/d",
        "/c",
        `echo ${marker}`,
      ],
      {
        cwd: os.tmpdir(),
        encoding: "utf8",
        windowsHide: true,
        timeout: SMOKE_TIMEOUT_MS,
      },
    );

  if (result.error) {
    throw new Error(
      `Codex Windows sandbox smoke test could not run: ${result.error.message}`,
    );
  }

  const output =
    `${result.stdout || ""}\n${result.stderr || ""}`;

  if (result.status !== 0) {
    throw new Error(
      `Codex Windows sandbox smoke test exited with ${result.status}`,
    );
  }

  if (!output.includes(marker)) {
    throw new Error(
      "Codex Windows sandbox smoke test did not return its marker",
    );
  }

  if (
    /CreateProcessAsUserW failed|CreateProcessWithLogonW failed|orchestrator_helper_launch_failed/i
      .test(output)
  ) {
    throw new Error(
      "Codex Windows sandbox smoke test reported a process-launch failure",
    );
  }

  return {
    ok: true,
    markerObserved: true,
  };
}

function repairCodexWindowsSandbox({
  codexHome =
    process.env.CODEX_HOME?.trim()
      ? path.resolve(process.env.CODEX_HOME.trim())
      : path.join(os.homedir(), ".codex"),
  smoke = false,
} = {}) {
  if (process.platform !== "win32") {
    return {
      supported: false,
      changed: false,
      smokeTested: false,
      smokeOk: null,
    };
  }

  const codexExe =
    locateCodexExecutable();

  const version =
    readCodexVersion(codexExe);

  const resources =
    locateCodexResources(
      codexHome,
      version,
    );

  const codexBin =
    path.dirname(codexExe);

  const sandboxBin =
    path.join(
      codexHome,
      ".sandbox-bin",
    );

  const stamp =
    new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "");

  const targets = [
    {
      source: resources.setup,
      destination:
        path.join(
          codexBin,
          SETUP_HELPER,
        ),
    },
    {
      source: resources.runner,
      destination:
        path.join(
          codexBin,
          COMMAND_RUNNER,
        ),
    },
    {
      source: resources.setup,
      destination:
        path.join(
          sandboxBin,
          SETUP_HELPER,
        ),
    },
    {
      source: resources.runner,
      destination:
        path.join(
          sandboxBin,
          COMMAND_RUNNER,
        ),
    },
    {
      source: resources.runner,
      destination:
        path.join(
          sandboxBin,
          `codex-command-runner-${version}.exe`,
        ),
    },
  ];

  const operations =
    targets.map((target) =>
      copyVerified(
        target.source,
        target.destination,
        stamp,
      ));

  const changedTargets =
    operations
      .filter((operation) => operation.changed)
      .map((operation) => operation.destination);

  const backups =
    operations
      .map((operation) => operation.backup)
      .filter(Boolean);

  const shouldSmoke =
    smoke === true
    || changedTargets.length > 0;

  let smokeResult = null;

  if (shouldSmoke) {
    smokeResult =
      smokeCodexWindowsSandbox(
        codexExe,
      );
  }

  return {
    supported: true,
    codexExe,
    version,
    releaseName: resources.releaseName,
    resources: resources.resources,
    codexBin,
    sandboxBin,
    setupSha256:
      sha256(resources.setup),
    runnerSha256:
      sha256(resources.runner),
    changed:
      changedTargets.length > 0,
    changedTargets,
    backups,
    smokeTested:
      shouldSmoke,
    smokeOk:
      smokeResult?.ok ?? null,
  };
}

module.exports = {
  locateCodexExecutable,
  readCodexVersion,
  locateCodexResources,
  smokeCodexWindowsSandbox,
  repairCodexWindowsSandbox,
};