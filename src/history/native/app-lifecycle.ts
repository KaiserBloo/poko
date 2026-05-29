import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "../../core/logger.ts";

export type NativeAppLifecycle = {
  appName?: string;
  wasRunning: boolean;
  closed: boolean;
  reopened: boolean;
  reason?: string;
};

export type NativeAppController = {
  platform: NodeJS.Platform;
  appNames: string[];
  isRunning(appName: string): Promise<boolean>;
  quit(appName: string): Promise<void>;
  open(appName: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  closeTimeoutMs?: number;
};

type NativeAppLifecycleOptions = {
  displayName: string;
  appNames: string[];
  skipEnvVar: string;
  appController?: NativeAppController;
  logger?: Pick<Logger, "info" | "warn">;
};

const execFileAsync = promisify(execFile);

export const closeAppForNativeSync = async (
  options: NativeAppLifecycleOptions,
): Promise<NativeAppLifecycle> => {
  if (process.env[options.skipEnvVar] === "1") {
    return emptyLifecycle();
  }

  const controller =
    options.appController ?? createMacAppController(options.appNames);

  if (controller.platform !== "darwin") {
    options.logger?.warn(
      `${options.displayName} auto-close is only supported on macOS right now; make sure it is closed before native chat sync.`,
    );
    return emptyLifecycle();
  }

  const appName = await findRunningApp(controller);

  if (!appName) {
    return emptyLifecycle();
  }

  options.logger?.warn(
    `Poko needs to close ${options.displayName} to sync your data. It will reopen it when finished.`,
  );
  options.logger?.info(`Asking ${appName} to quit.`);

  try {
    await controller.quit(appName);
  } catch (error) {
    return {
      appName,
      wasRunning: true,
      closed: false,
      reopened: false,
      reason: `${options.displayName} could not be closed automatically: ${errorMessage(error)}`,
    };
  }

  options.logger?.info(`Waiting for ${options.displayName} to finish closing.`);

  const closed = await waitForAppState(controller, appName, false);

  if (!closed) {
    return {
      appName,
      wasRunning: true,
      closed: false,
      reopened: false,
      reason: `${options.displayName} did not close in time; native chat sync was skipped so the live database was not edited.`,
    };
  }

  options.logger?.info(
    `${options.displayName} is closed. Syncing native history now.`,
  );

  return {
    appName,
    wasRunning: true,
    closed: true,
    reopened: false,
  };
};

export const reopenAppAfterNativeSync = async (
  options: NativeAppLifecycleOptions,
  lifecycle: NativeAppLifecycle,
): Promise<void> => {
  if (!lifecycle.wasRunning || !lifecycle.closed || !lifecycle.appName) {
    return;
  }

  const controller =
    options.appController ?? createMacAppController(options.appNames);

  options.logger?.info(`Reopening ${options.displayName}.`);

  try {
    await controller.open(lifecycle.appName);
    const reopened = await waitForAppState(
      controller,
      lifecycle.appName,
      true,
      5000,
    );

    lifecycle.reopened = reopened;

    if (!reopened) {
      options.logger?.warn(
        `${options.displayName} did not report as reopened yet; you may need to open it manually.`,
      );
    }
  } catch (error) {
    options.logger?.warn(
      `${options.displayName} history sync finished, but reopening failed: ${errorMessage(error)}`,
    );
  }
};

const emptyLifecycle = (): NativeAppLifecycle => ({
  wasRunning: false,
  closed: false,
  reopened: false,
});

const createMacAppController = (appNames: string[]): NativeAppController => ({
  platform: process.platform,
  appNames,
  isRunning: isMacAppRunning,
  quit: quitMacApp,
  open: openMacApp,
  wait: sleep,
});

const findRunningApp = async (
  controller: NativeAppController,
): Promise<string | undefined> => {
  for (const appName of controller.appNames) {
    if (await controller.isRunning(appName)) {
      return appName;
    }
  }

  return undefined;
};

const waitForAppState = async (
  controller: NativeAppController,
  appName: string,
  expectedRunning: boolean,
  timeoutMs = controller.closeTimeoutMs ?? 15000,
): Promise<boolean> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if ((await controller.isRunning(appName)) === expectedRunning) {
      return true;
    }

    await controller.wait(500);
  }

  return false;
};

const isMacAppRunning = async (appName: string): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      `application ${appleScriptString(appName)} is running`,
    ]);

    return stdout.trim() === "true";
  } catch {
    return false;
  }
};

const quitMacApp = async (appName: string): Promise<void> => {
  await execFileAsync("osascript", [
    "-e",
    `tell application ${appleScriptString(appName)} to quit`,
  ]);
};

const openMacApp = async (appName: string): Promise<void> => {
  await execFileAsync("open", ["-a", appName]);
};

const appleScriptString = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
