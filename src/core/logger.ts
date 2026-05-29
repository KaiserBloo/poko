import pc from "picocolors";

export type Logger = {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  plain(message: string): void;
};

export const createLogger = (): Logger => ({
  info(message) {
    console.log(`${pc.cyan("poko")} ${message}`);
  },
  success(message) {
    console.log(`${pc.green("poko")} ${pc.green("✓")} ${message}`);
  },
  warn(message) {
    console.warn(`${pc.yellow("poko")} ${pc.yellow("!")} ${message}`);
  },
  error(message) {
    console.error(`${pc.red("poko")} ${pc.red("x")} ${message}`);
  },
  plain(message) {
    console.log(message);
  },
});

export const createSilentLogger = (): Logger => ({
  info() {},
  success() {},
  warn() {},
  error() {},
  plain() {},
});
