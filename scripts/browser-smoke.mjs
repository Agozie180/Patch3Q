import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const targetUrl = process.env.PATCH3Q_BROWSER_URL ?? "http://127.0.0.1:4173/";
const outputDirectory = path.resolve("evidence");
const chromeCandidates = [
  process.env.PATCH3Q_CHROME_PATH,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
  process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));

if (!chromePath) {
  throw new Error("Chrome was not found. Set PATCH3Q_CHROME_PATH to an installed Chrome or Chromium executable.");
}

await mkdir(outputDirectory, { recursive: true });
const profileDirectory = await mkdtemp(path.join(tmpdir(), "patch3q-browser-smoke-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDirectory}`,
  "--window-size=1440,1400",
  targetUrl,
], { stdio: "ignore" });

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readDevToolsPort() {
  const portFile = path.join(profileDirectory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
      if (port) return port;
    } catch {
      // Chrome creates the file after its debugging endpoint is ready.
    }
    await pause(100);
  }
  throw new Error("Chrome did not expose a DevTools debugging port.");
}

let socket;
try {
  const port = await readDevToolsPort();
  let page;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    page = targets.find((target) => target.type === "page" && target.url.startsWith(targetUrl));
    if (page) break;
    await pause(100);
  }
  if (!page) throw new Error(`Chrome did not open ${targetUrl}.`);

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  const pageErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push({
        type: "exception",
        text: message.params.exceptionDetails.text,
        url: message.params.exceptionDetails.url ?? null,
      });
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      pageErrors.push({
        type: "log",
        text: message.params.entry.text,
        url: message.params.entry.url ?? null,
      });
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      pageErrors.push({
        type: "console",
        text: message.params.args.map((argument) => argument.value ?? argument.description ?? "").join(" "),
        url: null,
      });
    }
  });

  function command(method, params = {}) {
    const id = ++commandId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async function capture(fileName) {
    const result = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(path.join(outputDirectory, fileName), Buffer.from(result.data, "base64"));
  }

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1400,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#root')?.children.length)");
    if (ready) break;
    if (attempt === 99) throw new Error("Patch3Q did not finish rendering.");
    await pause(100);
  }

  const home = await evaluate(`(() => ({
    title: document.title,
    heading: document.querySelector('h1')?.innerText ?? '',
    workspaceTabs: [...document.querySelectorAll('[role="tab"]')].map((element) => element.textContent.trim()),
    qoreChainScenarioVisible: document.body.innerText.includes('Load QoreChain synthetic customer scenario'),
    dianaVisible: document.body.innerText.includes('DIANA TESTNET'),
  }))()`);
  await capture("browser-home.png");

  const approvalTabClicked = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent.includes('Approve bounty'));
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  await pause(250);
  const approval = await evaluate(`(() => ({
    selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() ?? '',
    heading: document.querySelector('#approval-title')?.innerText ?? '',
    description: document.querySelector('#approval-title')?.nextElementSibling?.innerText ?? '',
    emptyState: document.querySelector('.warning-callout')?.innerText ?? '',
  }))()`);
  await capture("browser-approval.png");

  const report = {
    generatedAt: new Date().toISOString(),
    targetUrl,
    chromePath,
    viewport: { width: 1440, height: 1400 },
    assertions: {
      homeRendered: home.heading.includes("Report the flaw"),
      fourWorkspaceTabsRendered: home.workspaceTabs.length === 4,
      qoreChainScenarioVisible: home.qoreChainScenarioVisible,
      dianaVisible: home.dianaVisible,
      approvalTabClicked,
      dualPartyApprovalVisible: approval.heading === "Approve severity with two PQ parties",
      noPageErrors: pageErrors.length === 0,
    },
    home,
    approval,
    pageErrors,
    screenshots: ["evidence/browser-home.png", "evidence/browser-approval.png"],
  };
  await writeFile(path.join(outputDirectory, "browser-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (Object.values(report.assertions).some((value) => !value)) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  socket?.close();
  if (chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await Promise.race([exited, pause(5000)]);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(profileDirectory, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 19) throw error;
      await pause(100);
    }
  }
}
