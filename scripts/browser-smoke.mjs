import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const defaultTargetUrl = "http://127.0.0.1:4173/";
const targetUrl = process.env.PATCH3Q_BROWSER_URL ?? defaultTargetUrl;
const outputDirectory = path.resolve(process.env.PATCH3Q_BROWSER_OUTPUT ?? "evidence");
const checkLiveRecovery = process.env.PATCH3Q_BROWSER_LIVE_RECOVERY === "1";
const viewportWidth = Number(process.env.PATCH3Q_BROWSER_WIDTH ?? 1440);
const viewportHeight = Number(process.env.PATCH3Q_BROWSER_HEIGHT ?? 1400);
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
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const outputPath = (fileName) => path.relative(process.cwd(), path.join(outputDirectory, fileName)).replaceAll("\\", "/");

if (!chromePath) {
  throw new Error("Chrome was not found. Set PATCH3Q_CHROME_PATH to an installed Chrome or Chromium executable.");
}

let preview;
async function targetIsReady() {
  try {
    const response = await fetch(targetUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

if (targetUrl === defaultTargetUrl && !(await targetIsReady())) {
  preview = spawn(process.execPath, [
    path.resolve("node_modules/vite/bin/vite.js"),
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
  ], { stdio: "ignore" });
  for (let attempt = 0; attempt < 100 && !(await targetIsReady()); attempt += 1) {
    if (preview.exitCode !== null) throw new Error("Vite preview exited before the browser smoke test started.");
    await pause(100);
  }
  if (!(await targetIsReady())) throw new Error("Patch3Q preview did not become ready at " + targetUrl);
}

await mkdir(outputDirectory, { recursive: true });
const profileDirectory = await mkdtemp(path.join(tmpdir(), "patch3q-browser-smoke-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-background-mode",
  "--disable-extensions",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDirectory}`,
  `--window-size=${viewportWidth},${viewportHeight}`,
  targetUrl,
], { stdio: "ignore", windowsHide: true });

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
let closeBrowser;
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

  closeBrowser = () => command("Browser.close");

  async function waitFor(expression, label, attempts = 300) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  async function capture(fileName) {
    const result = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(path.join(outputDirectory, fileName), Buffer.from(result.data, "base64"));
  }

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#root')?.children.length)");
    if (ready) break;
    if (attempt === 99) {
      const diagnostics = await evaluate(`({
        readyState: document.readyState,
        rootHtml: document.querySelector('#root')?.innerHTML ?? null,
        bodyText: document.body?.innerText ?? '',
      })`);
      throw new Error(`Patch3Q did not finish rendering: ${JSON.stringify({ diagnostics, pageErrors })}`);
    }
    await pause(100);
  }

  const home = await evaluate(`(() => ({
    title: document.title,
    heading: document.querySelector('h1')?.innerText ?? '',
    workspaceTabs: [...document.querySelectorAll('[role="tab"]')].map((element) => element.textContent.trim()),
    qoreChainScenarioVisible: document.body.innerText.includes('Load QoreChain synthetic customer scenario'),
    dianaVisible: Boolean(document.querySelector('[aria-label="Diana testnet"]')),
    guaranteeVisible: document.body.innerText.includes('Pre-funded case + missed SLA'),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
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
    auditorTrust: [...document.querySelectorAll('.warning-callout')]
      .find((element) => element.textContent.includes('verified V3 deployment'))?.innerText ?? '',
    emptyState: [...document.querySelectorAll('.warning-callout')]
      .find((element) => element.textContent.includes('No case loaded'))?.innerText ?? '',
  }))()`);
  await capture("browser-approval.png");

  const v4TabClicked = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent.includes('V4 pool & quorum'));
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  await waitFor("Boolean(document.querySelector('#v4-title'))", "the V4 pool and quorum workspace");
  const v4 = await evaluate(`(() => ({
    heading: document.querySelector('#v4-title')?.innerText ?? '',
    policyVisible: document.body.innerText.includes('Program policy and pool'),
    deliveryVisible: document.body.innerText.includes('Publish or recover encrypted delivery'),
    quorumVisible: document.body.innerText.includes('Collect quorum and release'),
  }))()`);
  await capture("browser-v4.png");

  const injectedWalletButtonClicked = await evaluate(`(() => {
    const provider = {
      isQoreX: true,
      request: async ({ method }) => {
        if (method === 'eth_chainId') return '0x2648';
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
          return ['0x1000000000000000000000000000000000000001'];
        }
        throw new Error('Unexpected mock wallet method: ' + method);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
    window.qorex = { evm: provider };
    window.ethereum = provider;
    const button = document.querySelector('.wallet-button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await pause(300);
  const injectedWalletConnected = await evaluate("document.querySelector('.wallet-button')?.textContent.includes('0x1000') ?? false");
  const injectedWalletDisconnected = await evaluate(`(() => {
    const button = document.querySelector('.wallet-button.connected');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await pause(100);

  const sealTabClicked = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent.includes('Seal report'));
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  await waitFor("Boolean(document.querySelector('#seal-title'))", "the seal workspace");
  const scenarioLoaded = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent.includes('Load QoreChain synthetic customer scenario'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await pause(100);
  const sealSubmitted = await evaluate(`(() => {
    const form = document.querySelector('#seal-title')?.closest('section')?.querySelector('form');
    if (!form) return false;
    form.requestSubmit();
    return true;
  })()`);
  await waitFor("Boolean(document.querySelector('#receipt-title'))", "a sealed disclosure receipt");
  const sealed = await evaluate(`(() => ({
    heading: document.querySelector('#receipt-title')?.textContent.trim() ?? '',
    caseId: document.querySelector('.receipt-head strong')?.textContent.trim() ?? '',
    payoutCommitmentVisible: document.body.innerText.includes('Sealed payout commitment'),
  }))()`);
  await capture("browser-sealed.png");

  const auditorCheckOpened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent.includes('Run the independent auditor check'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await waitFor("Boolean(document.querySelector('#verify-title'))", "the independent verification workspace");
  const verificationStarted = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent.includes('Decrypt & verify evidence'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await waitFor(
    "document.querySelector('.verification-result.verified h3')?.textContent.includes('Authentic Patch3Q disclosure') ?? false",
    "successful independent decryption and verification",
  );
  const verified = await evaluate(`(() => ({
    heading: document.querySelector('.verification-result.verified h3')?.textContent.trim() ?? '',
    checks: [...document.querySelectorAll('.verification-result.verified .check-grid strong')].map((element) => element.textContent.trim()),
    payoutOpened: Boolean(document.querySelector('.decrypted-report code')),
  }))()`);

  const loadedApprovalTabClicked = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent.includes('Approve bounty'));
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  await waitFor("Boolean(document.querySelector('#approval-title'))", "the loaded approval workspace");
  const rationaleEntered = await evaluate(`(() => {
    const field = document.querySelector('textarea[placeholder^="Why this impact"]');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, 'Critical loss of escrowed funds; reproduced and independently verified.');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await pause(100);
  const approvalStarted = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent.includes('Co-sign severity approval'));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  await waitFor(
    "document.querySelector('.verification-result.verified h3')?.textContent.includes('Payout instruction verified') ?? false",
    "the dual-PQ severity approval",
  );
  const approved = await evaluate(`(() => ({
    heading: document.querySelector('.verification-result.verified h3')?.textContent.trim() ?? '',
    signatures: document.querySelector('.verification-result.verified .eyebrow')?.textContent.trim() ?? '',
    classicalForgeriesRejected: [...document.querySelectorAll('.verification-result.verified .check-grid div')]
      .filter((element) => element.textContent.includes('ECDSA-only forgery'))
      .every((element) => element.textContent.includes('Rejected')),
  }))()`);
  await evaluate("document.querySelector('.verification-result.verified')?.scrollIntoView({ block: 'start' }); true");
  await pause(100);
  await capture("browser-journey.png");

  let liveCaseId;
  let liveRecovery;
  if (checkLiveRecovery) {
    liveCaseId = JSON.parse(readFileSync("evidence/v4-lifecycle.json", "utf8")).caseId;
    await evaluate(`[...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.includes('V4 pool & quorum')).click(); true`);
    const readRecovery = () => evaluate(`({
      notice: document.querySelector('.transaction-status')?.textContent ?? '',
      error: document.querySelector('.error-callout')?.textContent ?? ''
    })`);
    await waitFor(`Boolean(document.querySelector('input[placeholder="P3Q-…"]'))`, "the V4 recovery form");
    const clickRecover = () => evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Recover & verify')).click(); true`);
    await clickRecover();
    await waitFor(`document.querySelector('.error-callout')?.textContent.includes('Enter a case ID')`, "the empty case validation");
    await evaluate(`(() => {
      const field = document.querySelector('input[placeholder="P3Q-…"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(liveCaseId)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await clickRecover();
    for (let i = 0; i < 250; i += 1) {
      liveRecovery = await readRecovery();
      if (liveRecovery.error || liveRecovery.notice) break;
      await pause(200);
    }
    await capture("browser-live-recovery.png");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    targetUrl,
    chromePath,
    viewport: { width: viewportWidth, height: viewportHeight },
    assertions: {
      homeRendered: home.heading.includes("Report the flaw"),
      fiveWorkspaceTabsRendered: home.workspaceTabs.length === 5,
      qoreChainScenarioVisible: home.qoreChainScenarioVisible,
      dianaVisible: home.dianaVisible,
      guaranteeBoundaryVisible: home.guaranteeVisible,
      noHorizontalOverflow: !home.horizontalOverflow,
      approvalTabClicked,
      dualPartyApprovalVisible: approval.heading === "Approve severity with two PQ parties",
      auditorTrustBoundaryVisible: approval.auditorTrust.includes("verified V3 deployment"),
      approvalEmptyStateVisible: approval.emptyState.includes("No case loaded"),
      v4TabClicked,
      v4PolicyVisible: v4.policyVisible,
      v4DurableDeliveryVisible: v4.deliveryVisible,
      v4QuorumVisible: v4.quorumVisible,
      injectedWalletButtonClicked,
      injectedWalletConnected,
      injectedWalletDisconnected,
      sealTabClicked,
      scenarioLoaded,
      sealSubmitted,
      disclosureSealed: sealed.heading.includes("sealed with post-quantum encryption"),
      payoutCommitmentVisible: sealed.payoutCommitmentVisible,
      auditorCheckOpened,
      verificationStarted,
      disclosureVerified: verified.heading === "Authentic Patch3Q disclosure",
      payoutOpened: verified.payoutOpened,
      loadedApprovalTabClicked,
      rationaleEntered,
      approvalStarted,
      dualPqApprovalVerified: approved.heading === "Payout instruction verified",
      classicalOnlyForgeriesRejected: approved.classicalForgeriesRejected,
      ...(checkLiveRecovery && { liveBundleRecovered: liveRecovery.notice.includes("SHA-256 verified bundle") }),
      noPageErrors: pageErrors.length === 0,
    },
    home,
    approval,
    v4,
    journey: { sealed, verified, approved },
    ...(checkLiveRecovery && { liveRecovery }),
    pageErrors,
    screenshots: [
      outputPath("browser-home.png"),
      outputPath("browser-approval.png"),
      outputPath("browser-v4.png"),
      outputPath("browser-sealed.png"),
      outputPath("browser-journey.png"),
      ...(checkLiveRecovery ? [outputPath("browser-live-recovery.png")] : []),
    ],
  };
  await writeFile(path.join(outputDirectory, "browser-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (Object.values(report.assertions).some((value) => !value)) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  const browserExited = chrome.exitCode === null && chrome.signalCode === null
    ? new Promise((resolve) => chrome.once("exit", resolve))
    : Promise.resolve();
  if (closeBrowser) await Promise.race([closeBrowser().catch(() => {}), pause(2_000)]);
  socket?.close();
  await Promise.race([browserExited, pause(3_000)]);
  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill();
    await Promise.race([browserExited, pause(5_000)]);
  }
  if (preview?.exitCode === null) {
    const exited = new Promise((resolve) => preview.once("exit", resolve));
    preview.kill();
    await Promise.race([exited, pause(5_000)]);
  }
  const absoluteProfileDirectory = path.resolve(profileDirectory);
  if (path.dirname(absoluteProfileDirectory) !== path.resolve(tmpdir()) || !path.basename(absoluteProfileDirectory).startsWith("patch3q-browser-smoke-")) {
    throw new Error("Refusing to remove a browser profile outside the task's temporary directory.");
  }
  try {
    await rm(absoluteProfileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== "win32" || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    console.warn(`Windows retained a lock on the temporary browser profile (${error.code}): ${absoluteProfileDirectory}`);
  }
}
