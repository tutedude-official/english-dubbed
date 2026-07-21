const chalk = require("chalk");

function timestamp() {
  return new Date().toLocaleTimeString("en-IN", { hour12: false });
}

function ts() {
  return chalk.dim(`[${timestamp()}]`);
}

const logger = {
  // ── Generic ────────────────────────────────────────────────────────────────

  /** Plain info line with timestamp */
  info(msg) {
    process.stdout.write(`${ts()} ${chalk.cyan(msg)}\n`);
  },

  /** Success line — green ✓ */
  success(msg) {
    process.stdout.write(`${ts()} ${chalk.green("✓")} ${chalk.green(msg)}\n`);
  },

  /** Error line — red ✗ */
  error(msg) {
    process.stdout.write(`${ts()} ${chalk.red("✗")} ${chalk.red(msg)}\n`);
  },

  /** Warning line — yellow ⚠ */
  warn(msg) {
    process.stdout.write(`${ts()} ${chalk.yellow("⚠")} ${chalk.yellow(msg)}\n`);
  },

  /** Step header — bold blue */
  step(msg) {
    process.stdout.write(`${ts()} ${chalk.bold.blue(msg)}\n`);
  },

  /** Dim detail line (timing, paths, counts) */
  detail(msg) {
    process.stdout.write(`${ts()}   ${chalk.dim(msg)}\n`);
  },

  /** Inline write (no newline) — for "Uploading... done" patterns */
  write(msg) {
    process.stdout.write(`${ts()} ${chalk.cyan(msg)}`);
  },

  /** Append "done" to an inline write line */
  done(extra = "") {
    process.stdout.write(chalk.green(` done${extra ? "  " + chalk.dim(extra) : ""}\n`));
  },

  /** Append a plain suffix to an inline write line (e.g. "NOT FOUND") */
  append(msg) {
    process.stdout.write(`${chalk.yellow(msg)}\n`);
  },

  // ── Structural ─────────────────────────────────────────────────────────────

  /** Full-width double-line banner */
  banner(title) {
    const line = "═".repeat(80);
    console.log("\n" + chalk.bold.magenta(line));
    console.log(chalk.bold.magenta("  " + title));
    console.log(chalk.bold.magenta(line));
  },

  /** Full-width single-line divider */
  divider() {
    console.log(chalk.dim("─".repeat(80)));
  },

  /** Thin divider used inside banners */
  thinDivider() {
    console.log(chalk.dim("  " + "─".repeat(56)));
  },

  /** Key/value summary row */
  kv(label, value) {
    console.log(`  ${chalk.bold.white(label.padEnd(18))} ${chalk.whiteBright(value)}`);
  },
};

module.exports = logger;
