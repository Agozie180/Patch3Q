import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const defaultTargetUrl = "http://127.0.0.1:4173/";
const targetUrl = process.env.PATCH3Q_BROWSER_URL ?? defaultTargetUrl;
const outputDirectory = path.resolve(process.env.PATCH3Q_BROWSER_OUTPUT ?? "evidence");
const viewportWidth = Number(process.env.PATCH3Q_BROWSER_WIDTH ?? 1440);
const viewportHeight = Number(process.env.PATCH3Q_BROWSER_HEIGHT ?? 1400);
const browserEngine = process.env.PATCH3Q_BROWSER_ENGINE ?? "chromium";
const firefox = browserEngine === "firefox";
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
  throw new Error("Browser was not found. Set PATCH3Q_CHROME_PATH to its installed executable.");
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
const chrome = firefox ? spawn(process.env.PATCH3Q_PYTHON_PATH ?? "python", [
  path.resolve("scripts/firefox-smoke-bridge.py"), chromePath, targetUrl, profileDirectory,
], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true }) : spawn(chromePath, [
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
  if (firefox) {
    const events = new EventTarget();
    socket = events;
    socket.send = (value) => chrome.stdin.write(value + "\n");
    socket.close = () => chrome.stdin.end();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Firefox WebDriver did not become ready.")), 120_000);
      chrome.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Firefox bridge exited with ${code}.`)); });
      const lines = createInterface({ input: chrome.stdout });
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.ready) { clearTimeout(timer); resolve(); return; }
        const event = new Event("message");
        event.data = line;
        events.dispatchEvent(event);
      });
    });
  } else {
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
  }

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
  closeBrowser = firefox ? undefined : () => command("Browser.close");

  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async function waitFor(expression, label, attempts = 300) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    await capture("browser-failure.png");
    const diagnostic = await evaluate(`({ headings: [...document.querySelectorAll('h2,.workspace-heading .eyebrow')].map(element => element.textContent),
      selects: [...document.querySelectorAll('select')].map(element => ({ value: element.value, options: [...element.options].map(option => option.textContent) })),
      errors: [...document.querySelectorAll('.error-callout')].map(element => element.textContent) })`);
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
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
    deadlineDemoAboveFold: (() => {
      const link = document.querySelector('#open-deadline-case');
      const box = link?.getBoundingClientRect();
      return Boolean(box?.width && box.top >= 0 && box.bottom <= window.innerHeight);
    })(),
    v5LiveVisible: document.body.innerText.includes('V5 live on Diana'),
  }))()`);
  await capture("browser-home.png");

  await evaluate("document.querySelector('#open-deadline-case').click(); true");
  await waitFor("document.querySelector('.case-verification')?.dataset.verification === 'confirmed'", "all four missed-deadline receipts");
  const deadlineCase = await evaluate(`(() => ({
    heading: document.querySelector('#deadline-title')?.textContent,
    receiptLinks: [...document.querySelectorAll('.case-timeline a')].map((link) => link.href),
    localSigningAvailable: Boolean(document.querySelector('#start-quorum-demo')),
  }))()`);
  await capture("browser-deadline-case.png");

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

  const anchorTabClicked = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent.includes('Anchor & escrow'));
    if (!tab) return false;
    tab.click(); return true;
  })()`);
  await waitFor("Boolean(document.querySelector('#anchor-title'))", "the anchor and escrow workspace");
  const anchor = await evaluate(`({ heading: document.querySelector('#anchor-title')?.innerText ?? '',
    disconnectedWritesDisabled: [...document.querySelectorAll('.anchor-workspace .primary-button')].every((button) => button.disabled) })`);
  await capture("browser-anchor.png");

  const v4TabClicked = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent.includes('Pool & quorum'));
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
    classicalForgeriesRejected: (() => {
      const rows = [...document.querySelectorAll('.verification-result.verified .check-grid div')].filter((element) => element.textContent.includes('ECDSA-only forgery'));
      return rows.length === 2 && rows.every((element) => element.textContent.includes('Rejected'));
    })(),
  }))()`);
  await evaluate("document.querySelector('.verification-result.verified')?.scrollIntoView({ block: 'start' }); true");
  await pause(100);
  await capture("browser-journey.png");

  async function clickQuorumApproval() {
    return evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((element) => element.textContent.includes('Create & verify quorum approval'));
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`);
  }
  async function selectDemoParticipant(role) {
    await evaluate(`(() => {
      const field = [...document.querySelectorAll('#v4-title ~ * select, section[aria-labelledby="v4-title"] select')].find((element) => [...element.options].some((option) => option.value === 'reporter'));
      if (!field) throw new Error('Participant selector missing');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(field, ${JSON.stringify(role)});
      field.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await pause(100);
  }
  const quorumDemoStarted = await evaluate(`(() => {
    const button = document.querySelector('#start-quorum-demo');
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  await waitFor("document.body.innerText.includes('Local quorum demo') && document.body.innerText.includes('2-of-3')", "the one-click quorum demo");
  await evaluate("document.querySelector('.wallet-button')?.click(); true");
  await waitFor("Boolean(document.querySelector('.wallet-button.connected'))", "the connected demo wallet");
  const connectedDemoWritesDisabled = await evaluate(`(() => {
    const labels = ['Configure V5 program policy', '1. Approve pool token', '2. Deposit program pool', 'Relay, reserve, and publish case'];
    const writes = [...document.querySelectorAll('button')].filter((button) => labels.some((label) => button.textContent.includes(label)));
    return Boolean(document.querySelector('.wallet-button.connected')) && writes.length === 4 && writes.every((button) => button.disabled);
  })()`);
  const normalQuorumStarted = await clickQuorumApproval();
  await waitFor("document.querySelector('.verification-result.verified h3')?.textContent === 'V5 payout quorum verified'", "program plus two auditors");
  const normalQuorum = await evaluate(`(() => ({
    role: document.querySelector('.verification-result.verified .eyebrow')?.textContent,
    checks: [...document.querySelectorAll('.verification-result.verified .check-grid strong')].map((element) => element.textContent),
    releaseDisabled: [...document.querySelectorAll('button')].find((element) => element.textContent.includes('Release reserved bounty'))?.disabled === true,
    vaultsCleared: [...document.querySelectorAll('textarea')].filter((element) => element.placeholder.includes('approval vault')).every((element) => element.value === '' || element.value === '[]'),
  }))()`);
  await evaluate("document.querySelector('.verification-result.verified')?.scrollIntoView({ block: 'start' }); true");
  await capture("browser-quorum-normal.png");
  await selectDemoParticipant("reporter");
  const reporterQuorumStarted = await clickQuorumApproval();
  await waitFor("document.querySelector('.verification-result.verified .eyebrow')?.textContent.includes('reporter + 2 unique auditors')", "reporter plus two auditors");
  const reporterQuorum = await evaluate(`({
    role: document.querySelector('.verification-result.verified .eyebrow')?.textContent,
    checks: [...document.querySelectorAll('.verification-result.verified .check-grid strong')].map((element) => element.textContent),
  })`);
  await capture("browser-quorum-reporter.png");
  await selectDemoParticipant("program");
  const rejectionStarted = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent.includes('Create & verify rejection quorum'));
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  await waitFor("document.querySelector('.verification-result.verified h3')?.textContent === 'V5 rejection quorum verified'", "the V5 rejection verdict");
  const rejectionDemo = await evaluate(`({
    checks: [...document.querySelectorAll('.verification-result.verified .check-grid strong')].map((element) => element.textContent),
    submitDisabled: [...document.querySelectorAll('button')].find((element) => element.textContent.includes('Reject case & return reserve'))?.disabled === true,
  })`);
  await capture("browser-rejection.png");
  await selectDemoParticipant("program");
  await evaluate(`(() => {
    const field = document.querySelector('textarea[placeholder="[auditorVault1, auditorVault2]"]');
    const vaults = JSON.parse(field.value);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, JSON.stringify([vaults[0], vaults[0]]));
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(100); await clickQuorumApproval();
  await waitFor("document.querySelector('.error-callout')?.textContent.includes('Duplicate auditor')", "duplicate auditor rejection");
  const duplicateQuorumRejected = await evaluate("!document.querySelector('.verification-result.verified')");
  await selectDemoParticipant("reporter");
  await evaluate(`(() => {
    const field = document.querySelector('textarea[placeholder="[auditorVault1, auditorVault2]"]');
    const vaults = JSON.parse(field.value);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, JSON.stringify([vaults[0]]));
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(100); await clickQuorumApproval();
  await waitFor("document.querySelector('.error-callout')?.textContent.includes('Not enough auditor')", "insufficient quorum rejection");
  const insufficientQuorumRejected = await evaluate("!document.querySelector('.verification-result.verified')");

  await evaluate(`(() => {
    const field = [...document.querySelectorAll('select')].find((element) => [...element.options].some((option) => option.value === '4'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(field, '4');
    field.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('.workspace-heading .eyebrow')?.textContent === 'V4 funded bounty workspace'", "the preserved V4 workspace");
  const legacyV4Available = await evaluate("!document.body.innerText.includes('Reject an invalid report')");
  await evaluate(`(() => {
    const field = [...document.querySelectorAll('select')].find((element) => [...element.options].some((option) => option.value === '4'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(field, '5');
    field.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.wallet-button.connected')?.click();
  })()`);
  await pause(300);
  const liveEvidence = JSON.parse(fs.readFileSync("evidence/v5-lifecycle.json", "utf8"));
  async function recoverLiveCase(caseId, status, poolAtomic = "19000000000", version = 5) {
    await evaluate(`(() => {
      const field = document.querySelector('input[placeholder="P3Q-…"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(caseId)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await pause(100);
    await evaluate(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Recover & verify')).click(); })()`);
    await waitFor(`document.body.innerText.includes(${JSON.stringify(caseId)}) && [...document.querySelectorAll('.v4-state-grid div')].some((element) => element.textContent.includes('On-chain status') && element.textContent.includes(${JSON.stringify(status)}))`, `the live V${version} ${status} case`);
    await waitFor(`document.body.innerText.includes(${JSON.stringify(poolAtomic + " atomic")})
      ${version === 5 ? "&& document.body.innerText.includes('604800 seconds') && document.body.innerText.includes('Decision deadline')" : ""}`, "the recovered policy and decision reads");
    const selectedVersion = `[...document.querySelectorAll('select')].find((element) => [...element.options].some((option) => option.value === '4'))?.value`;
    await waitFor("document.body.innerText.includes('Recovered and SHA-256 verified bundle')", "the recovery confirmation");
    return evaluate(`({ status: ${JSON.stringify(status)}, poolVisible: document.body.innerText.includes(${JSON.stringify(poolAtomic + " atomic")}),
      graceVisible: document.body.innerText.includes('604800 seconds'),
      decisionVisible: document.body.innerText.includes('Decision deadline'),
      version: ${selectedVersion},
      recoveryConfirmed: document.body.innerText.includes('Recovered and SHA-256 verified bundle') })`);
  }
  const recoveredPaid = await recoverLiveCase(liveEvidence.cases.normal.caseId, "Disclosed");
  await capture("browser-live-paid.png");
  const recoveredRejected = await recoverLiveCase(liveEvidence.cases.rejected.caseId, "Rejected");
  await capture("browser-live-rejected.png");
  await evaluate(`(() => {
    const field = [...document.querySelectorAll('select')].find((element) => [...element.options].some((option) => option.value === '4'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(field, '4');
    field.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await pause(200);
  const legacyEvidence = JSON.parse(fs.readFileSync("evidence/v4-lifecycle.json", "utf8"));
  const recoveredLegacy = await recoverLiveCase(legacyEvidence.caseId, "Resolved", "22500000000", 4);
  await capture("browser-live-v4.png");

  const report = {
    generatedAt: new Date().toISOString(),
    targetUrl,
    chromePath,
    browserEngine,
    viewport: { width: viewportWidth, height: viewportHeight },
    assertions: {
      homeRendered: home.heading.includes("Private bug reports") && home.heading.includes("Funded bounties"),
      deadlineDemoAboveFold: home.deadlineDemoAboveFold,
      deadlineReceiptsConfirmed: deadlineCase.heading?.includes("The researcher got paid") && deadlineCase.receiptLinks.length === 4 && deadlineCase.receiptLinks.every((link) => link.startsWith("https://dashboard.qorechain.io/explorer/tx/")),
      quorumDemoVisible: deadlineCase.localSigningAvailable,
      v5LiveVisible: home.v5LiveVisible,
      fiveWorkspaceTabsRendered: home.workspaceTabs.length === 5,
      qoreChainScenarioVisible: home.qoreChainScenarioVisible,
      dianaVisible: home.dianaVisible,
      guaranteeBoundaryVisible: home.guaranteeVisible,
      noHorizontalOverflow: !home.horizontalOverflow,
      approvalTabClicked,
      dualPartyApprovalVisible: approval.heading === "Approve severity with two PQ parties",
      auditorTrustBoundaryVisible: approval.auditorTrust.includes("verified V3 deployment"),
      approvalEmptyStateVisible: approval.emptyState.includes("No case loaded"),
      anchorTabClicked,
      anchorWorkspaceRendered: anchor.heading === "Anchor the encrypted receipt",
      disconnectedAnchorWritesDisabled: anchor.disconnectedWritesDisabled,
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
      quorumDemoStarted,
      normalQuorumStarted,
      programAndTwoAuditorsVerified: normalQuorum.role === "program + 2 unique auditors" && normalQuorum.checks.length > 10 && normalQuorum.checks.every((check) => check === "Pass"),
      demoReleaseDisabled: normalQuorum.releaseDisabled,
      connectedDemoWritesDisabled,
      signingVaultsCleared: normalQuorum.vaultsCleared,
      reporterQuorumStarted,
      reporterAndTwoAuditorsVerified: reporterQuorum.role === "reporter + 2 unique auditors" && reporterQuorum.checks.length > 10 && reporterQuorum.checks.every((check) => check === "Pass"),
      duplicateQuorumRejected,
      insufficientQuorumRejected,
      rejectionStarted,
      v5RejectionVerified: rejectionDemo.checks.length > 8 && rejectionDemo.checks.every((check) => check === "Pass"),
      localRejectionSubmissionDisabled: rejectionDemo.submitDisabled,
      legacyV4Available,
      livePaidCaseRecovered: recoveredPaid.status === "Disclosed" && recoveredPaid.poolVisible && recoveredPaid.graceVisible && recoveredPaid.decisionVisible && recoveredPaid.recoveryConfirmed && recoveredPaid.version === "5",
      liveRejectedCaseRecovered: recoveredRejected.status === "Rejected" && recoveredRejected.poolVisible && recoveredRejected.graceVisible && recoveredRejected.decisionVisible && recoveredRejected.recoveryConfirmed && recoveredRejected.version === "5",
      liveV4CaseRecovered: recoveredLegacy.status === "Resolved" && recoveredLegacy.poolVisible && recoveredLegacy.recoveryConfirmed && recoveredLegacy.version === "4",
      noPageErrors: pageErrors.length === 0,
    },
    home,
    deadlineCase,
    approval,
    anchor,
    v4,
    journey: { sealed, verified, approved },
    quorumJourney: { normalQuorum, reporterQuorum },
    rejectionDemo,
    liveRecovery: { recoveredPaid, recoveredRejected, recoveredLegacy },
    pageErrors,
    screenshots: [
      outputPath("browser-home.png"),
      outputPath("browser-deadline-case.png"),
      outputPath("browser-approval.png"),
      outputPath("browser-v4.png"),
      outputPath("browser-sealed.png"),
      outputPath("browser-journey.png"),
      outputPath("browser-anchor.png"),
      outputPath("browser-quorum-normal.png"),
      outputPath("browser-quorum-reporter.png"),
      outputPath("browser-rejection.png"),
      outputPath("browser-live-paid.png"),
      outputPath("browser-live-rejected.png"),
      outputPath("browser-live-v4.png"),
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
  await Promise.race([browserExited, pause(firefox ? 10_000 : 3_000)]);
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
