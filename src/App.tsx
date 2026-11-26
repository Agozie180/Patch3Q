import { useEffect, useMemo, useState } from "react";
import { isAddress, sha256 as viemSha256, toBytes, zeroAddress, zeroHash } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  currentV4Deployment,
  currentV5Deployment,
  escrowTokenAbi,
  patch3qRegistryAbi,
  patch3qRegistryAddress,
  patch3qRegistryV4Abi as legacyV4Abi,
  patch3qRegistryV4Address as legacyV4Address,
  patch3qRegistryV5Abi,
  patch3qRegistryV5Address,
} from "./contract.js";
import { DeadlineCase } from "./DeadlineCase.js";
import { bytesToHex, fileToAttachment, fromBase64, fromBase64Url } from "./lib/encoding.js";
import {
  approvalToJson,
  approvalVaultToJson,
  createSeverityApproval,
  demonstrateClassicalOnlyForgeryRejection,
  parseApprovalVault,
  parseSeverityApproval,
  verifySeverityApproval,
} from "./lib/approval.js";
import {
  bundleToJson,
  hashText,
  MAX_ATTACHMENT_BYTES,
  openBundle,
  parseBundle,
  parseVault,
  sealReport,
  vaultToJson,
} from "./lib/patch3q.js";
import {
  bundleAuditorThreshold,
  createV4QuorumApproval,
  v4ApprovalToJson,
  v4CaseStatus,
  v4ParticipantRole,
  verifyV4QuorumApproval,
} from "./lib/v4-approval.js";
import { fetchV4Bundle, v4BundleHex } from "./lib/v4-bundle.js";
import { createV5Rejection, verifyV5Rejection, type V5Rejection } from "./lib/v5-rejection.js";
import type {
  OpenResult,
  ApprovalVerificationResult,
  Patch3QApprovalVault,
  Patch3QBundle,
  Patch3QKeyVault,
  ReportAttachment,
  ReportDraft,
  ReporterMode,
  SealedPayout,
  SealResult,
  Severity,
  SeverityApproval,
  V4ApprovalVerificationResult,
  V4SeverityApproval,
} from "./types.js";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "./wallet.js";
import "./styles.css";

type Workspace = "seal" | "verify" | "approve" | "anchor" | "v4";

function localDateAfter(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

const INITIAL_REPORT: ReportDraft = {
  title: "",
  program: "",
  asset: "",
  severity: "high",
  reporterAlias: "",
  summary: "",
  impact: "",
  reproduction: "",
  remediation: "",
  embargoUntil: localDateAfter(30),
};

const QORECHAIN_DEMO_REPORT: ReportDraft = {
  title: "Synthetic demo: duplicate signer accepted in threshold verification",
  program: "QoreChain security — security@qore.network",
  asset: "Synthetic QoreChain verifier used only for the Patch3Q demo",
  severity: "critical",
  reporterAlias: "researcher-zero",
  summary: "A synthetic threshold verifier counts the same signer twice. This is demonstration data, not a claim about a live QoreChain vulnerability.",
  impact: "In the demo scenario, an attacker satisfies quorum without two independent signers and reaches a protected action.",
  reproduction: "1. Create one valid signature.\n2. Submit the same signer entry twice to the synthetic verifier.\n3. Observe the demo verifier accepting the threshold.",
  remediation: "Reject duplicate signer identifiers before accumulating signature weight, then add a regression test for repeated entries.",
  embargoUntil: localDateAfter(30),
};

function downloadText(filename: string, content: string, mediaType = "application/json"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function shortHash(value: string): string {
  return value.length > 25 ? value.slice(0, 14) + "…" + value.slice(-10) : value;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function StepMark({ number, active }: { number: string; active?: boolean }) {
  return <span className={active ? "step-mark active" : "step-mark"}>{number}</span>;
}

function StatusDot({ good }: { good: boolean }) {
  return <span className={good ? "status-dot good" : "status-dot bad"} aria-hidden="true" />;
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect, isPending: isDisconnecting } = useDisconnect();
  const [error, setError] = useState("");

  async function connectWallet() {
    setError("");
    const preferred = connectors.find((connector) => connector.id === "qorex") ?? connectors[0];
    if (!preferred) {
      setError("No injected wallet connector is available.");
      return;
    }
    try {
      await connectAsync({ connector: preferred });
    } catch (caught) {
      const fallback = connectors.find((connector) => connector.id !== preferred.id);
      if (preferred.id === "qorex" && fallback) {
        try {
          await connectAsync({ connector: fallback });
          return;
        } catch (fallbackError) {
          setError(fallbackError instanceof Error ? fallbackError.message : "Wallet connection failed.");
          return;
        }
      }
      setError(caught instanceof Error ? caught.message : "Wallet connection failed.");
    }
  }

  if (isConnected && address) {
    return (
      <button
        className="wallet-button connected"
        type="button"
        disabled={isDisconnecting}
        onClick={() => disconnect()}
        title="Disconnect wallet"
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      className="wallet-button"
      type="button"
      disabled={isConnecting}
      onClick={() => void connectWallet()}
      title={error || "Connect QoreX or another injected wallet"}
    >
      {isConnecting ? "Connecting…" : error ? "Retry wallet" : "Connect wallet"}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="hash-row">
      <div>
        <span>{label}</span>
        <code title={value}>{shortHash(value)}</code>
      </div>
      <button className="icon-button" type="button" onClick={copy} aria-label={"Copy " + label}>
        {copied ? "Done" : "Copy"}
      </button>
    </div>
  );
}

function PrivacyLedger({ bundle }: { bundle?: Patch3QBundle }) {
  const anonymous = bundle ? bundle.privacy.reporterMode === "anonymous" : true;
  const bucket = bundle ? Math.round(bundle.privacy.sizeBucket / 1024) + " KiB bucket" : "16 KiB – 1 MiB buckets";
  return (
    <div className="privacy-ledger" aria-label="What the public chain can and cannot see">
      <div>
        <span className="ledger-label public">Public on QoreChain</span>
        <ul>
          <li>Case, ciphertext and content hashes</li>
          <li>Program, auditor set and relayer accounts</li>
          <li>Deadlines and lifecycle events</li>
          <li>Payout amount, only at release</li>
        </ul>
      </div>
      <div>
        <span className="ledger-label sealed">Sealed or never published</span>
        <ul>
          <li>Report, PoC and researcher alias</li>
          <li>{anonymous ? "Reporter wallet — there is none" : "Reporter wallet is public in account mode"}</li>
          <li>{anonymous ? "Payout address until the bounty is paid" : "Payout goes to the reporter account"}</li>
          <li>True report size — padded to a {bucket}</li>
          <li>Severity rationale — salted before hashing</li>
        </ul>
      </div>
    </div>
  );
}

function downloadPayoutWallet(): `0x${string}` {
  const privateKey = generatePrivateKey();
  const { address } = privateKeyToAccount(privateKey);
  downloadText("patch3q-payout-wallet-" + address.slice(2, 8) + ".json", JSON.stringify({
    type: "patch3q.payout-wallet",
    address,
    privateKey,
    warning: "PAYOUT SECRET — import into a wallet you have never linked to your identity. Never share it.",
  }, null, 2));
  return address;
}

function SealWorkspace({
  onResult,
  onVerify,
}: {
  onResult: (result: SealResult) => void;
  onVerify: (bundle: Patch3QBundle, vault: Patch3QKeyVault) => void;
}) {
  const { address: reporterAddress, isConnected } = useAccount();
  const [draft, setDraft] = useState(INITIAL_REPORT);
  const [mode, setMode] = useState<"demo" | "testnet">("demo");
  const [reporterMode, setReporterMode] = useState<ReporterMode>("anonymous");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [maintainerAddress, setMaintainerAddress] = useState("");
  const [auditorAddress, setAuditorAddress] = useState("");
  const [quorumMode, setQuorumMode] = useState(false);
  const [additionalAuditors, setAdditionalAuditors] = useState("");
  const [attachment, setAttachment] = useState<ReportAttachment>();
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [result, setResult] = useState<SealResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof ReportDraft>(field: K, value: ReportDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function selectAttachment(file?: File) {
    setError("");
    if (!file) {
      setAttachment(undefined);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError("The PoC is larger than 512 KiB. Use a minimal reproducer or attach a hash and retrieval instructions.");
      return;
    }
    setAttachmentBusy(true);
    try {
      setAttachment(await fileToAttachment(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the attachment.");
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function handleSeal(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const demoPayout = mode === "demo" && !payoutAddress.trim()
        ? privateKeyToAccount(generatePrivateKey()).address
        : payoutAddress;
      const sealed = await sealReport({
        report: draft,
        attachment,
        mode,
        reporterMode,
        payoutAddress: reporterMode === "anonymous" ? demoPayout : undefined,
        reporterAddress,
        maintainerAddress,
        auditorAddress,
        auditorAddresses: quorumMode
          ? [auditorAddress, ...additionalAuditors.split(/[\s,]+/u)].map((value) => value.trim()).filter(Boolean)
          : undefined,
        demoAuditorCount: quorumMode ? 3 : 1,
        auditorThreshold: quorumMode ? 2 : 1,
      });
      setResult(sealed);
      onResult(sealed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Patch3Q could not seal this report.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <section className="workspace receipt-view" aria-labelledby="receipt-title">
        <div className="success-orbit" aria-hidden="true">
          <span>✓</span>
        </div>
        <p className="eyebrow success-text">Sealed locally</p>
        <h2 id="receipt-title">Your disclosure is sealed with post-quantum encryption.</h2>
        <p className="lead compact">
          One ciphertext, two independent paths to recovery. No report plaintext left this browser.
        </p>

        <div className="receipt-card">
          <div className="receipt-head">
            <div>
              <span className="muted-label">Case receipt</span>
              <strong>{result.bundle.caseId}</strong>
            </div>
            <span className="pill positive">Integrity ready</span>
          </div>
          <div className="receipt-grid">
            <div>
              <span>Encryption</span>
              <strong>{result.bundle.sealMode === "hybrid" ? "ML-KEM-1024 + X25519" : "ML-KEM-1024"}</strong>
            </div>
            <div>
              <span>Recipients</span>
              <strong>{result.bundle.recipients.length} recipient slots</strong>
            </div>
            <div>
              <span>Acknowledge by</span>
              <strong>{formatDate(result.bundle.publicMetadata.acknowledgeBy)}</strong>
            </div>
            <div>
              <span>Embargo until</span>
              <strong>{formatDate(result.bundle.publicMetadata.embargoUntil)}</strong>
            </div>
          </div>
          <HashRow label="Envelope SHA-256" value={result.bundle.envelopeHash} />
          <HashRow label="Salted content commitment" value={result.bundle.contentCommitment} />
          {result.bundle.privacy.payoutCommitment && (
            <HashRow label="Sealed payout commitment" value={result.bundle.privacy.payoutCommitment} />
          )}
        </div>
        <PrivacyLedger bundle={result.bundle} />

        <div className="action-stack">
          <button
            className="primary-button"
            type="button"
            onClick={() => downloadText(result.bundle.caseId + ".patch3q.json", bundleToJson(result.bundle))}
          >
            <span>↓</span> Download encrypted bundle
          </button>
          {result.vaults.map((vault) => (
            <button
              className="secondary-button"
              type="button"
              key={vault.role}
              onClick={() => downloadText(result.bundle.caseId + "." + vault.role + ".vault.json", vaultToJson(vault))}
            >
              <span>⌘</span> Export {vault.role} demo vault
            </button>
          ))}
          {result.approvalVaults?.map((vault) => (
            <button
              className="secondary-button"
              type="button"
              key={vault.role + "-approval"}
              onClick={() => downloadText(
                result.bundle.caseId + "." + vault.role + "-approval.vault.json",
                approvalVaultToJson(vault),
              )}
            >
              <span>⌘</span> {vault.role === "reporter" && result.bundle.privacy.reporterMode === "anonymous"
                ? "Export reporter per-case key"
                : "Export " + vault.role + " approval vault"}
            </button>
          ))}
        </div>
        <div className="anchor-note">
          <strong>{result.bundle.approvalAuthorities?.auditors?.length && result.bundle.approvalAuthorities.auditors.length > 1
            ? "The funded registry can publish these encrypted bytes durably."
            : "Encrypted delivery is a separate V3 step."}</strong>{" "}
          {result.bundle.approvalAuthorities?.auditors?.length && result.bundle.approvalAuthorities.auditors.length > 1
            ? "Open Pool & quorum to reserve the bounty and publish the encrypted bundle in QoreChain logs. Never publish a recipient vault."
            : "Send the .patch3q.json file to both recipients through a monitored channel, then anchor its matching envelope hash. Never send a recipient vault with the bundle."}
        </div>
        {result.vaults.length > 0 && (
          <div className="warning-callout">
            <strong>Keep vaults separate.</strong>
            <span>They are demo secret keys. Send each vault only to its named recipient and never commit it to Git.</span>
          </div>
        )}
        <div className="receipt-footer">
          {result.vaults[1] && (
            <button className="text-button" type="button" onClick={() => onVerify(result.bundle, result.vaults[1])}>
              Run the independent auditor check →
            </button>
          )}
          <button className="text-button quiet" type="button" onClick={() => setResult(undefined)}>
            Seal another report
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace" aria-labelledby="seal-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Reporter workspace</p>
          <h2 id="seal-title">Seal a vulnerability report</h2>
          <p>Structured evidence encrypted in your browser for the people who need to act.</p>
        </div>
        <div>
          <div className="local-badge"><span /> Local-only plaintext</div>
          <button className="text-button quiet" type="button" onClick={() => setDraft({ ...QORECHAIN_DEMO_REPORT, embargoUntil: localDateAfter(30) })}>
            Load QoreChain synthetic customer scenario
          </button>
        </div>
      </div>

      <form onSubmit={handleSeal}>
        <div className="section-heading">
          <StepMark number="01" active />
          <div>
            <h3>Disclosure details</h3>
            <p>Everything in this section is encrypted.</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Vulnerability title" wide>
            <input required value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="e.g. Signature bypass in bridge verifier" />
          </Field>
          <Field label="Program / project">
            <input required value={draft.program} onChange={(event) => update("program", event.target.value)} placeholder="QoreChain" />
          </Field>
          <Field label="Affected asset">
            <input required value={draft.asset} onChange={(event) => update("asset", event.target.value)} placeholder="Repository, contract, or endpoint" />
          </Field>
          <Field label="Claimed severity">
            <select value={draft.severity} onChange={(event) => update("severity", event.target.value as ReportDraft["severity"])}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="informational">Informational</option>
            </select>
          </Field>
          <Field label="Reporter alias" hint="Use a pseudonym; identity is not required.">
            <input required value={draft.reporterAlias} onChange={(event) => update("reporterAlias", event.target.value)} placeholder="researcher-zero" />
          </Field>
          <Field label="Summary" wide>
            <textarea required rows={4} value={draft.summary} onChange={(event) => update("summary", event.target.value)} placeholder="What is broken, and where?" />
          </Field>
          <Field label="Security impact" wide>
            <textarea required rows={4} value={draft.impact} onChange={(event) => update("impact", event.target.value)} placeholder="What can an attacker gain or disrupt?" />
          </Field>
          <Field label="Reproduction steps" wide>
            <textarea required rows={7} value={draft.reproduction} onChange={(event) => update("reproduction", event.target.value)} placeholder={"1. Prepare…\n2. Submit…\n3. Observe…"} />
          </Field>
          <Field label="Suggested remediation" wide>
            <textarea required rows={4} value={draft.remediation} onChange={(event) => update("remediation", event.target.value)} placeholder="A focused mitigation or patch direction." />
          </Field>
          <Field label="Requested embargo end" hint="The public receipt exposes this date, not the report.">
            <input required type="date" min={localDateAfter(8)} value={draft.embargoUntil} onChange={(event) => update("embargoUntil", event.target.value)} />
          </Field>
          <Field label="Proof-of-concept file" hint="Maximum 512 KiB for the hackathon demo.">
            <div className="file-picker">
              <input type="file" onChange={(event) => void selectAttachment(event.target.files?.[0])} />
              <span>{attachmentBusy ? "Hashing…" : attachment ? attachment.name + " · " + Math.ceil(attachment.size / 1024) + " KiB" : "Choose minimal PoC"}</span>
            </div>
          </Field>
        </div>

        <div className="section-heading divided">
          <StepMark number="02" active />
          <div>
            <h3>Choose your privacy</h3>
            <p>Anonymous mode needs no wallet: a relayer anchors the receipt and the bounty lands at a fresh address.</p>
          </div>
        </div>
        <div className="mode-switch" role="group" aria-label="Reporter privacy">
          <button type="button" className={reporterMode === "anonymous" ? "selected" : ""} onClick={() => setReporterMode("anonymous")}>
            <strong>Anonymous reporter</strong>
            <span>No on-chain identity · sealed payout address</span>
          </button>
          <button type="button" className={reporterMode === "account" ? "selected" : ""} onClick={() => setReporterMode("account")}>
            <strong>Reporter account</strong>
            <span>Your registered wallet anchors and is paid</span>
          </button>
        </div>
        {reporterMode === "anonymous" && (
          <div className="form-grid recipient-addresses">
            <Field
              label="Fresh payout address"
              hint={mode === "demo"
                ? "Leave blank in demo mode to use a throwaway address. It is sealed inside the ciphertext."
                : "Sealed until payout. Generated wallets use ECDSA; recipient PQ protection requires separate setup."}
              wide
            >
              <div className="wallet-field">
                <input value={payoutAddress} onChange={(event) => setPayoutAddress(event.target.value)} placeholder="0x… never used with your identity" />
                <button className="secondary-button" type="button" onClick={() => setPayoutAddress(downloadPayoutWallet())}>
                  Generate &amp; download
                </button>
              </div>
            </Field>
          </div>
        )}

        <div className="section-heading divided">
          <StepMark number="03" active />
          <div>
            <h3>Choose recipients</h3>
            <p>Both recipients can decrypt independently; neither can lock out the other.</p>
          </div>
        </div>
        <div className="mode-switch" role="group" aria-label="Auditor policy">
          <button type="button" className={!quorumMode ? "selected" : ""} onClick={() => setQuorumMode(false)}>
            <strong>V3 single auditor</strong>
            <span>Existing verified Diana deployment</span>
          </button>
          <button type="button" className={quorumMode ? "selected" : ""} onClick={() => setQuorumMode(true)}>
            <strong>2-of-3 auditor quorum</strong>
            <span>Pre-funded pool · no single-auditor lockout</span>
          </button>
        </div>
        <div className="mode-switch" role="group" aria-label="Recipient mode">
          <button type="button" className={mode === "demo" ? "selected" : ""} onClick={() => setMode("demo")}>
            <strong>Demo vaults</strong>
            <span>Fresh hybrid keys generated locally</span>
          </button>
          <button type="button" className={mode === "testnet" ? "selected" : ""} onClick={() => setMode("testnet")}>
            <strong>QoreChain testnet</strong>
            <span>Resolve registered ML-KEM keys</span>
          </button>
        </div>

        {mode === "demo" ? (
          <div className="recipient-list">
            <div className="recipient-row">
              <span className="recipient-icon">M</span>
              <div><strong>Program security team</strong><span>Primary maintainer recipient</span></div>
              <span className="pill">Generated on seal</span>
            </div>
            <div className="recipient-row">
              <span className="recipient-icon auditor">A</span>
              <div><strong>{quorumMode ? "Three independent auditors" : "Independent auditor"}</strong><span>{quorumMode ? "Any two form the payout quorum" : "Escalation and SLA witness"}</span></div>
              <span className="pill">{quorumMode ? "2-of-3" : "Generated on seal"}</span>
            </div>
          </div>
        ) : (
          <div className="form-grid recipient-addresses">
            {reporterMode === "account" && (
              <Field label="Reporter QoreChain account" hint="This wallet is authenticated inside the sealed bundle." wide>
                <div className="wallet-field">
                  <input readOnly value={reporterAddress ?? "Connect the reporter wallet"} />
                  <WalletButton />
                </div>
              </Field>
            )}
            <Field label="Maintainer QoreChain address" wide>
              <input required value={maintainerAddress} onChange={(event) => setMaintainerAddress(event.target.value)} placeholder="qor1… or 0x…" />
            </Field>
            <Field label="Auditor QoreChain address" hint="Required for independent recovery and ML-DSA approval." wide>
              <input required value={auditorAddress} onChange={(event) => setAuditorAddress(event.target.value)} placeholder="qor1… or 0x…" />
            </Field>
            {quorumMode && (
              <Field label="Two additional auditor addresses" hint="Separate QoreChain addresses with spaces, commas, or new lines." wide>
                <textarea required rows={3} value={additionalAuditors} onChange={(event) => setAdditionalAuditors(event.target.value)} placeholder={"qor1…\nqor1…"} />
              </Field>
            )}
          </div>
        )}

        {error && <div className="error-callout" role="alert">{error}</div>}
        <button className="seal-button" type="submit" disabled={busy || attachmentBusy || (mode === "testnet" && reporterMode === "account" && !isConnected)}>
          <span className="seal-lock">{busy ? "◌" : "◇"}</span>
          <span><strong>{busy ? "Sealing with post-quantum keys…" : "Seal report"}</strong><small>ML-KEM-1024 · local encryption · {reporterMode === "anonymous" ? "no reporter identity" : "salted commitment"}</small></span>
          <span className="arrow">→</span>
        </button>
      </form>
    </section>
  );
}

function FileImport({ label, filename, onLoad }: { label: string; filename?: string; onLoad: (text: string) => void }) {
  async function load(file?: File) {
    if (file) onLoad(await file.text());
  }
  return (
    <label className={filename ? "import-box loaded" : "import-box"}>
      <input type="file" accept=".json,application/json" onChange={(event) => void load(event.target.files?.[0])} />
      <span className="import-icon">{filename ? "✓" : "＋"}</span>
      <strong>{filename || label}</strong>
      <small>{filename ? "Ready to verify" : "Choose a Patch3Q JSON file"}</small>
    </label>
  );
}

function VerifyWorkspace({
  initialBundle,
  initialVault,
  onBundle,
  onPayout,
}: {
  initialBundle?: Patch3QBundle;
  initialVault?: Patch3QKeyVault;
  onBundle: (bundle: Patch3QBundle) => void;
  onPayout: (payout?: SealedPayout) => void;
}) {
  const [bundleText, setBundleText] = useState(initialBundle ? bundleToJson(initialBundle) : "");
  const [vaultText, setVaultText] = useState(initialVault ? vaultToJson(initialVault) : "");
  const [bundleName, setBundleName] = useState(initialBundle?.caseId + ".patch3q.json");
  const [vaultName, setVaultName] = useState(initialVault ? initialVault.role + " vault" : "");
  const [result, setResult] = useState<OpenResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function verify() {
    setError("");
    setResult(undefined);
    setBusy(true);
    try {
      const bundle = parseBundle(bundleText);
      const vault = parseVault(vaultText);
      const opened = await openBundle(bundle, vault);
      setResult(opened);
      onBundle(bundle);
      onPayout(opened.verified ? opened.payload.payout : undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not decrypt and verify this case.");
    } finally {
      setBusy(false);
    }
  }

  function downloadAttachment() {
    if (!result?.payload.attachment) return;
    const attachment = result.payload.attachment;
    const bytes = Uint8Array.from(fromBase64Url(attachment.data));
    const url = URL.createObjectURL(new Blob([bytes.buffer], { type: attachment.mediaType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="workspace" aria-labelledby="verify-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Recipient workspace</p>
          <h2 id="verify-title">Open and verify independently</h2>
          <p>Decryption and every integrity check happen locally in this browser.</p>
        </div>
        <div className="local-badge"><span /> Zero server trust</div>
      </div>

      <div className="import-grid">
        <FileImport
          label="Import encrypted bundle"
          filename={bundleName || undefined}
          onLoad={(text) => { setBundleText(text); setBundleName("Encrypted case bundle"); setResult(undefined); }}
        />
        <FileImport
          label="Import recipient vault"
          filename={vaultName || undefined}
          onLoad={(text) => { setVaultText(text); setVaultName("Recipient demo vault"); setResult(undefined); }}
        />
      </div>
      <details className="paste-fallback">
        <summary>Or paste JSON manually</summary>
        <div className="paste-grid">
          <textarea value={bundleText} onChange={(event) => setBundleText(event.target.value)} placeholder="Patch3Q bundle JSON" rows={6} />
          <textarea value={vaultText} onChange={(event) => setVaultText(event.target.value)} placeholder="Recipient vault JSON" rows={6} />
        </div>
      </details>
      {error && <div className="error-callout" role="alert"><strong>Verification stopped.</strong> {error}</div>}
      <button className="primary-button verify-button" type="button" disabled={!bundleText || !vaultText || busy} onClick={() => void verify()}>
        {busy ? "Running post-quantum decapsulation…" : "Decrypt & verify evidence"}
      </button>

      {result && (
        <div className={result.verified ? "verification-result verified" : "verification-result failed"}>
          <div className="verification-head">
            <div className="verified-mark">{result.verified ? "✓" : "!"}</div>
            <div>
              <p className="eyebrow">{result.verified ? "All checks passed" : "Integrity warning"}</p>
              <h3>{result.verified ? "Authentic Patch3Q disclosure" : "Do not trust this bundle"}</h3>
            </div>
          </div>
          <div className="check-grid">
            {Object.entries(result.checks).map(([name, passed]) => (
              <div key={name}><StatusDot good={passed} /><span>{name.replace(/([A-Z])/g, " $1")}</span><strong>{passed ? "Pass" : "Fail"}</strong></div>
            ))}
          </div>
          <article className="decrypted-report">
            <div className="report-topline">
              <span className={"severity " + result.payload.report.severity}>{result.payload.report.severity}</span>
              <span>{result.payload.caseId}</span>
            </div>
            <h3>{result.payload.report.title}</h3>
            <p className="report-context">{result.payload.report.program} · {result.payload.report.asset} · submitted by {result.payload.report.reporterAlias}</p>
            <div className="report-section"><h4>Summary</h4><p>{result.payload.report.summary}</p></div>
            <div className="report-section"><h4>Security impact</h4><p>{result.payload.report.impact}</p></div>
            <div className="report-section"><h4>Reproduction</h4><pre>{result.payload.report.reproduction}</pre></div>
            <div className="report-section"><h4>Suggested remediation</h4><p>{result.payload.report.remediation}</p></div>
            {result.payload.payout && (
              <div className="report-section">
                <h4>Sealed payout instruction</h4>
                <p>Pay only <code>{result.payload.payout.recipient}</code>. It opens the commitment anchored at submission, so no signer can redirect it.</p>
              </div>
            )}
            {result.payload.attachment && (
              <button className="attachment-button" type="button" onClick={downloadAttachment}>
                ↓ {result.payload.attachment.name} <span>{Math.ceil(result.payload.attachment.size / 1024)} KiB · hash verified by commitment</span>
              </button>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

const SEVERITY_CODES: Record<Severity, number> = {
  informational: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};
const CASE_STATUSES = ["Submitted", "Acknowledged", "Triaged", "Resolved", "Disclosed", "Cancelled", "Escalated"] as const;

function ApprovalWorkspace({
  bundle,
  initialVaults,
  initialApproval,
  onApproval,
  payout,
}: {
  bundle?: Patch3QBundle;
  initialVaults?: Patch3QApprovalVault[];
  initialApproval?: SeverityApproval;
  onApproval: (approval: SeverityApproval) => void;
  payout?: SealedPayout;
}) {
  const { isConnected } = useAccount();
  const initialReporterVault = initialVaults?.find((vault) => vault.role === "reporter");
  const initialProgramVault = initialVaults?.find((vault) => vault.role === "program");
  const initialAuditorVault = initialVaults?.find((vault) => vault.role === "auditor");
  const [participantRole, setParticipantRole] = useState<"reporter" | "program">(
    initialApproval?.participantRole ?? "program",
  );
  const [participantVaultText, setParticipantVaultText] = useState(
    initialProgramVault ? approvalVaultToJson(initialProgramVault) : "",
  );
  const [auditorVaultText, setAuditorVaultText] = useState(
    initialAuditorVault ? approvalVaultToJson(initialAuditorVault) : "",
  );
  const [severity, setSeverity] = useState<Severity>("high");
  const [payoutAtomic, setPayoutAtomic] = useState("2500000000");
  const [rationale, setRationale] = useState("");
  const [approval, setApproval] = useState<SeverityApproval | undefined>(initialApproval);
  const [verification, setVerification] = useState<ApprovalVerificationResult>();
  const [classicalForgeryRejected, setClassicalForgeryRejected] = useState<{
    participant: boolean;
    auditor: boolean;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const approvalWrite = useWriteContract();
  const approvalReceipt = useWaitForTransactionReceipt({ hash: approvalWrite.data });
  const registryReady = Boolean(
    patch3qRegistryAddress && isAddress(patch3qRegistryAddress) && patch3qRegistryAddress !== zeroAddress,
  );
  const approvalCaseIdHash = useMemo(
    () => bundle ? viemSha256(toBytes(bundle.caseId)) : undefined,
    [bundle],
  );
  const approvalCaseRead = useReadContract({
    address: patch3qRegistryAddress ?? zeroAddress,
    abi: patch3qRegistryAbi,
    functionName: "caseState",
    args: [approvalCaseIdHash ?? zeroHash],
    query: { enabled: registryReady && bundle?.mode === "testnet" && Boolean(approvalCaseIdHash), retry: false },
  });
  const onchainParticipantRole = approvalCaseRead.data && Number(approvalCaseRead.data[0]) === 6
    ? "reporter" as const
    : approvalCaseRead.data
      ? "program" as const
      : undefined;

  useEffect(() => {
    if (!onchainParticipantRole || onchainParticipantRole === participantRole) return;
    setParticipantRole(onchainParticipantRole);
    const matchingVault = onchainParticipantRole === "reporter" ? initialReporterVault : initialProgramVault;
    setParticipantVaultText(matchingVault ? approvalVaultToJson(matchingVault) : "");
  }, [onchainParticipantRole, participantRole, initialReporterVault, initialProgramVault]);

  function chooseParticipantRole(role: "reporter" | "program") {
    setParticipantRole(role);
    const matchingVault = role === "reporter" ? initialReporterVault : initialProgramVault;
    setParticipantVaultText(matchingVault ? approvalVaultToJson(matchingVault) : "");
    setApproval(undefined);
    setVerification(undefined);
    setClassicalForgeryRejected(undefined);
  }

  async function issueApproval() {
    if (!bundle) return;
    setError("");
    if (!registryReady || !patch3qRegistryAddress) {
      setError("Deploy Patch3QRegistry and configure its address before signing the replay-protected approval.");
      return;
    }
    setBusy(true);
    try {
      const participantVault = parseApprovalVault(participantVaultText);
      const auditorVault = parseApprovalVault(auditorVaultText);
      const nextApproval = await createSeverityApproval({
        bundle,
        participantRole,
        vaults: { participant: participantVault, auditor: auditorVault },
        registryAddress: patch3qRegistryAddress,
        severity,
        payoutAtomic,
        rationale,
        payout,
      });
      const checked = await verifySeverityApproval(
        bundle,
        nextApproval,
        patch3qRegistryAddress,
        onchainParticipantRole,
      );
      const rejected = bundle.approvalAuthorities?.[participantRole].source === "embedded-demo" &&
        bundle.approvalAuthorities.auditor.source === "embedded-demo"
        ? {
            participant: await demonstrateClassicalOnlyForgeryRejection(bundle, nextApproval, participantVault),
            auditor: await demonstrateClassicalOnlyForgeryRejection(bundle, nextApproval, auditorVault),
          }
        : undefined;
      setApproval(nextApproval);
      setVerification(checked);
      setClassicalForgeryRejected(rejected);
      onApproval(nextApproval);
      // The signed approval contains only public keys and signatures. Remove the
      // pasted secret material from live form controls as soon as it is no longer
      // needed, reducing accidental exposure through screenshots or inspection.
      setParticipantVaultText("");
      setAuditorVaultText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the severity approval.");
    } finally {
      setBusy(false);
    }
  }

  async function loadApproval(text: string) {
    if (!bundle) return;
    setError("");
    if (!registryReady || !patch3qRegistryAddress) {
      setError("Configure the deployed registry before verifying which deployment an approval targets.");
      return;
    }
    setBusy(true);
    try {
      const imported = parseSeverityApproval(text);
      const checked = await verifySeverityApproval(
        bundle,
        imported,
        patch3qRegistryAddress,
        onchainParticipantRole,
      );
      setParticipantRole(imported.participantRole);
      setApproval(imported);
      setVerification(checked);
      setClassicalForgeryRejected(undefined);
      onApproval(imported);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify the imported approval.");
    } finally {
      setBusy(false);
    }
  }

  async function releaseEscrow() {
    if (!bundle || !approval) return;
    setError("");
    if (!registryReady || !patch3qRegistryAddress) {
      setError("Deploy Patch3QRegistry and set VITE_PATCH3Q_REGISTRY_ADDRESS first.");
      return;
    }
    if (!verification?.verified) {
      setError("The approval must pass every hybrid-signature and evidence-binding check first.");
      return;
    }
    const participantPqSignature = approval.signatures.participant.pq?.signature;
    const auditorPqSignature = approval.signatures.auditor.pq?.signature;
    if (!participantPqSignature || !auditorPqSignature) {
      setError(`The approval needs both ${approval.participantRole} and auditor ML-DSA-87 signatures.`);
      return;
    }
    try {
      const caseIdHash = await hashText(bundle.caseId);
      const severityCode = SEVERITY_CODES[approval.statement.severity];
      const payoutAmount = BigInt(approval.statement.payout.atomic);
      const participantSignature = bytesToHex(fromBase64(participantPqSignature));
      const auditorSignature = bytesToHex(fromBase64(auditorPqSignature));
      if (bundle.privacy.reporterMode === "anonymous") {
        const { recipient, commitmentSalt } = approval.statement.payout;
        const reporterKey = bundle.approvalAuthorities?.reporter.pqPublicKey;
        if (!recipient || !commitmentSalt) throw new Error("The approval does not carry the sealed payout instruction.");
        await approvalWrite.writeContractAsync({
          address: patch3qRegistryAddress,
          abi: patch3qRegistryAbi,
          functionName: "approveAnonymousSeverity",
          args: [
            caseIdHash,
            severityCode,
            payoutAmount,
            approval.statement.rationaleHash,
            recipient,
            commitmentSalt,
            approval.participantRole === "reporter" && reporterKey ? bytesToHex(fromBase64Url(reporterKey)) : "0x",
            participantSignature,
            auditorSignature,
          ],
        });
        return;
      }
      await approvalWrite.writeContractAsync({
        address: patch3qRegistryAddress,
        abi: patch3qRegistryAbi,
        functionName: "approveSeverity",
        args: [
          caseIdHash,
          severityCode,
          payoutAmount,
          approval.statement.rationaleHash,
          participantSignature,
          auditorSignature,
        ],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit the auditor approval.");
    }
  }

  return (
    <section className="workspace" aria-labelledby="approval-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Independent co-signing workspace</p>
          <h2 id="approval-title">Approve severity with two PQ parties</h2>
          <p>The program and auditor sign normal payouts; an escalated case requires the reporter and auditor instead.</p>
        </div>
        <WalletButton />
      </div>

      <div className="warning-callout">
        <strong>This workspace targets the verified V3 deployment.</strong>
        <span>V3 requires its single bound auditor. Use Pool &amp; quorum for a snapshotted 2-of-3 auditor set and automatic reserve.</span>
      </div>

      {!bundle ? (
        <div className="warning-callout">
          <strong>No case loaded.</strong>
          <span>Seal or verify a Patch3Q bundle before issuing a severity decision.</span>
        </div>
      ) : (
        <>
          <div className="receipt-card">
            <div className="receipt-head">
              <div><span className="muted-label">Evidence-bound case</span><strong>{bundle.caseId}</strong></div>
              <span className="pill positive">Two authorities locked</span>
            </div>
            {bundle.privacy.reporterMode === "anonymous" && (
              <div className={payout ? "anchor-note" : "warning-callout"}>
                <strong>{payout ? "Sealed payout loaded." : "Payout instruction missing."}</strong>{" "}
                <span>{payout
                  ? "The bounty can only go to " + shortHash(payout.recipient) + ", the address the reporter sealed."
                  : "Decrypt the case in Verify & open first: an anonymous bounty pays only the sealed payout address."}</span>
              </div>
            )}
            <HashRow label="Ciphertext commitment" value={bundle.envelopeHash} />
            <HashRow
              label={bundle.privacy.reporterMode === "anonymous" ? "Reporter per-case ML-DSA fingerprint" : "Reporter ML-DSA fingerprint"}
              value={bundle.approvalAuthorities?.reporter.keyFingerprint ?? "Unavailable"}
            />
            <HashRow label="Program ML-DSA fingerprint" value={bundle.approvalAuthorities?.program.keyFingerprint ?? "Unavailable"} />
            <HashRow label="Auditor ML-DSA fingerprint" value={bundle.approvalAuthorities?.auditor.keyFingerprint ?? "Unavailable"} />
          </div>

          <div className="section-heading divided">
            <StepMark number="01" active />
            <div><h3>Adjudicate the report</h3><p>The signed decision becomes the sole escrow release instruction.</p></div>
          </div>
          <div className="form-grid">
            <Field label="Required participant signer" hint={onchainParticipantRole ? "Derived from the on-chain case status." : "Program normally; reporter after escalation."}>
              <select
                value={participantRole}
                disabled={Boolean(onchainParticipantRole)}
                onChange={(event) => chooseParticipantRole(event.target.value as "reporter" | "program")}
              >
                <option value="program">Program</option>
                <option value="reporter">Reporter (escalated case)</option>
              </select>
            </Field>
            <Field label="Final severity">
              <select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="informational">Informational</option>
              </select>
            </Field>
            <Field label="Payout atomic units" hint="tUSDT uses 6 decimals; 2500000000 = 2,500 tUSDT.">
              <input inputMode="numeric" value={payoutAtomic} onChange={(event) => setPayoutAtomic(event.target.value)} />
            </Field>
            <Field label="Severity rationale" wide>
              <textarea rows={4} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Why this impact and payout are justified." />
            </Field>
          </div>

          <div className="warning-callout">
            <strong>Local signing only.</strong>
            <span>Approval vaults never leave this browser and their form values are cleared immediately after signing. Prefer file import and close the tab after use.</span>
          </div>

          {(participantRole === "reporter" ? initialReporterVault : initialProgramVault) || participantVaultText ? (
            <details className="paste-fallback" open={!(participantRole === "reporter" ? initialReporterVault : initialProgramVault)}>
              <summary>{participantRole === "reporter" ? "Reporter" : "Program"} approval vault</summary>
              <textarea autoComplete="off" spellCheck={false} value={participantVaultText} onChange={(event) => setParticipantVaultText(event.target.value)} placeholder={`Patch3Q ${participantRole} approval vault JSON`} rows={6} />
            </details>
          ) : (
            <FileImport
              label={`Import ${participantRole} approval vault`}
              onLoad={setParticipantVaultText}
            />
          )}
          {initialAuditorVault || auditorVaultText ? (
            <details className="paste-fallback" open={!initialAuditorVault}>
              <summary>Auditor approval vault</summary>
              <textarea autoComplete="off" spellCheck={false} value={auditorVaultText} onChange={(event) => setAuditorVaultText(event.target.value)} placeholder="Patch3Q auditor approval vault JSON" rows={6} />
            </details>
          ) : (
            <FileImport label="Import auditor approval vault" onLoad={setAuditorVaultText} />
          )}

          {error && <div className="error-callout" role="alert">{error}</div>}
          <button className="primary-button verify-button" type="button" disabled={!participantVaultText || !auditorVaultText || busy} onClick={() => void issueApproval()}>
            {busy ? "Collecting two ML-DSA-87 signatures…" : "Co-sign severity approval"}
          </button>

          <details className="paste-fallback">
            <summary>Or verify an externally signed approval</summary>
            <FileImport label="Import severity approval" onLoad={(text) => void loadApproval(text)} />
          </details>

          {approval && verification && (
            <div className={verification.verified ? "verification-result verified" : "verification-result failed"}>
              <div className="verification-head">
                <div className="verified-mark">{verification.verified ? "✓" : "!"}</div>
                <div>
                  <p className="eyebrow">{approval.participantRole} + auditor · 2 × ML-DSA-87 hybrid signatures</p>
                  <h3>{verification.verified ? "Payout instruction verified" : "Approval rejected"}</h3>
                </div>
              </div>
              <div className="check-grid">
                {Object.entries(verification.checks).map(([name, passed]) => (
                  <div key={name}><StatusDot good={passed} /><span>{name.replace(/([A-Z])/g, " $1")}</span><strong>{passed ? "Pass" : "Fail"}</strong></div>
                ))}
                {classicalForgeryRejected && Object.entries(classicalForgeryRejected).map(([role, rejected]) => (
                  <div key={role}><StatusDot good={rejected} /><span>{role} ECDSA-only forgery</span><strong>{rejected ? "Rejected" : "Accepted"}</strong></div>
                ))}
              </div>
              <HashRow label="Approval commitment" value={approval.approvalHash} />
              <div className="action-stack">
                <button className="secondary-button" type="button" onClick={() => downloadText(bundle.caseId + ".approval.json", approvalToJson(approval))}>
                  ↓ Download signed approval
                </button>
                <button className="primary-button" type="button" disabled={bundle.mode !== "testnet" || !isConnected || approvalWrite.isPending || !verification.verified} onClick={() => void releaseEscrow()}>
                  {bundle.mode !== "testnet" ? "Demo approvals are local proof only" : approvalWrite.isPending ? "Confirm auditor transaction…" : isConnected ? "Anchor approval & release escrow" : "Connect auditor wallet to release"}
                </button>
              </div>
              {approvalWrite.data && (
                <div className="transaction-status">
                  <StatusDot good={approvalReceipt.isSuccess} />
                  <div><strong>{approvalReceipt.isSuccess ? "Bounty released" : "Approval submitted"}</strong><code>{approvalWrite.data}</code></div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AnchorWorkspace({ bundle }: { bundle?: Patch3QBundle }) {
  const { address, isConnected } = useAccount();
  const [bountyAtomic, setBountyAtomic] = useState("2500000000");
  const [redactedReport, setRedactedReport] = useState("");
  const [localError, setLocalError] = useState("");
  const write = useWriteContract();
  const tokenWrite = useWriteContract();
  const fundWrite = useWriteContract();
  const discloseWrite = useWriteContract();
  const lifecycleWrite = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });
  const tokenReceipt = useWaitForTransactionReceipt({ hash: tokenWrite.data });
  const fundReceipt = useWaitForTransactionReceipt({ hash: fundWrite.data });
  const discloseReceipt = useWaitForTransactionReceipt({ hash: discloseWrite.data });
  const lifecycleReceipt = useWaitForTransactionReceipt({ hash: lifecycleWrite.data });
  const registryReady = Boolean(
    patch3qRegistryAddress && isAddress(patch3qRegistryAddress) && patch3qRegistryAddress !== zeroAddress,
  );
  const caseIdHash = useMemo(
    () => bundle ? viemSha256(toBytes(bundle.caseId)) : undefined,
    [bundle],
  );
  const bountyTokenRead = useReadContract({
    address: patch3qRegistryAddress ?? zeroAddress,
    abi: patch3qRegistryAbi,
    functionName: "bountyToken",
    query: { enabled: registryReady },
  });
  const caseRead = useReadContract({
    address: patch3qRegistryAddress ?? zeroAddress,
    abi: patch3qRegistryAbi,
    functionName: "caseState",
    args: [caseIdHash ?? zeroHash],
    query: { enabled: registryReady && bundle?.mode === "testnet" && Boolean(caseIdHash), retry: false },
  });
  const deadlineRead = useReadContract({
    address: patch3qRegistryAddress ?? zeroAddress,
    abi: patch3qRegistryAbi,
    functionName: "deadlineState",
    args: [caseIdHash ?? zeroHash],
    query: { enabled: registryReady && bundle?.mode === "testnet" && Boolean(caseIdHash), retry: false },
  });
  const tokenAddress = bountyTokenRead.data;
  const caseState = caseRead.data;
  const currentStatus = caseState ? Number(caseState[0]) : undefined;
  const escrowedAmount = caseState ? BigInt(caseState[3]) : 0n;
  const connectedIsProgram = Boolean(
    address && caseState && address.toLowerCase() === caseState[8].toLowerCase(),
  );
  const connectedIsAuditor = Boolean(
    address && caseState && address.toLowerCase() === caseState[9].toLowerCase(),
  );
  const connectedIsParticipant = Boolean(
    address && caseState &&
    (address.toLowerCase() === caseState[7].toLowerCase() || address.toLowerCase() === caseState[8].toLowerCase()),
  );
  const connectedCanDisclose = connectedIsParticipant || Boolean(
    bundle?.privacy.reporterMode === "anonymous" && connectedIsAuditor && caseState?.[10] !== zeroHash,
  );

  useEffect(() => {
    if (
      receipt.isSuccess || fundReceipt.isSuccess || discloseReceipt.isSuccess ||
      lifecycleReceipt.isSuccess
    ) {
      void caseRead.refetch();
      void deadlineRead.refetch();
    }
  }, [receipt.isSuccess, fundReceipt.isSuccess, discloseReceipt.isSuccess, lifecycleReceipt.isSuccess]);

  async function anchor() {
    if (!bundle) return;
    setLocalError("");
    if (bundle.mode !== "testnet") {
      setLocalError("Demo-vault bundles use unregistered local keys and cannot be anchored. Seal in QoreChain testnet mode.");
      return;
    }
    if (!registryReady || !patch3qRegistryAddress) {
      setLocalError("Deploy Patch3QRegistry and set VITE_PATCH3Q_REGISTRY_ADDRESS first.");
      return;
    }
    const authorities = bundle.approvalAuthorities;
    if (
      !authorities ||
      !isAddress(authorities.reporter.evmAddress) ||
      !isAddress(authorities.program.evmAddress) ||
      !isAddress(authorities.auditor.evmAddress)
    ) {
      setLocalError("This bundle does not contain valid program and auditor approval authorities.");
      return;
    }
    const anonymous = bundle.privacy.reporterMode === "anonymous";
    if (anonymous) {
      const connected = address?.toLowerCase();
      if (!connected) {
        setLocalError("Connect any funded relayer wallet. It is never linked to the reporter.");
        return;
      }
      if (connected === authorities.program.evmAddress.toLowerCase() || connected === authorities.auditor.evmAddress.toLowerCase()) {
        setLocalError("The relayer must be a third account, not the program or the auditor.");
        return;
      }
    } else if (!address || address.toLowerCase() !== authorities.reporter.evmAddress.toLowerCase()) {
      setLocalError("Connect the reporter wallet authenticated inside this sealed bundle.");
      return;
    }
    try {
      const caseIdHash = await hashText(bundle.caseId);
      const programRef = await hashText(bundle.recipients[0]?.address?.toLowerCase() || authorities.program.evmAddress.toLowerCase());
      const deadlines = [
        BigInt(Math.floor(Date.parse(bundle.publicMetadata.acknowledgeBy) / 1000)),
        BigInt(Math.floor(Date.parse(bundle.publicMetadata.triageBy) / 1000)),
        BigInt(Math.floor(Date.parse(bundle.publicMetadata.embargoUntil) / 1000)),
      ] as const;
      if (anonymous) {
        const { reporterPqKeyHash, payoutCommitment } = bundle.privacy;
        if (!reporterPqKeyHash || !payoutCommitment) throw new Error("This anonymous bundle is missing its commitments.");
        await write.writeContractAsync({
          address: patch3qRegistryAddress,
          abi: patch3qRegistryAbi,
          functionName: "submitAnonymousCase",
          args: [
            authorities.program.evmAddress,
            authorities.auditor.evmAddress,
            caseIdHash,
            bundle.envelopeHash,
            bundle.contentCommitment,
            programRef,
            ...deadlines,
            reporterPqKeyHash,
            payoutCommitment,
          ],
        });
        return;
      }
      await write.writeContractAsync({
        address: patch3qRegistryAddress,
        abi: patch3qRegistryAbi,
        functionName: "submitCase",
        args: [
          authorities.program.evmAddress,
          authorities.auditor.evmAddress,
          caseIdHash,
          bundle.envelopeHash,
          bundle.contentCommitment,
          programRef,
          BigInt(Math.floor(Date.parse(bundle.publicMetadata.acknowledgeBy) / 1000)),
          BigInt(Math.floor(Date.parse(bundle.publicMetadata.triageBy) / 1000)),
          BigInt(Math.floor(Date.parse(bundle.publicMetadata.embargoUntil) / 1000)),
        ],
      });
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not submit the receipt transaction.");
    }
  }

  async function advanceLifecycle(
    functionName: "acknowledgeCase" | "triageCase" | "resolveCase" | "recordDeadlineBreaches" | "escalateMissedDeadline",
  ) {
    setLocalError("");
    if (!registryReady || !patch3qRegistryAddress || !caseIdHash) {
      setLocalError("Anchor the case and configure the registry first.");
      return;
    }
    try {
      await lifecycleWrite.writeContractAsync({
        address: patch3qRegistryAddress,
        abi: patch3qRegistryAbi,
        functionName,
        args: [caseIdHash],
      });
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not advance the case lifecycle.");
    }
  }

  function escrowInputs(): { token: `0x${string}`; amount: bigint } | undefined {
    if (!tokenAddress || !isAddress(tokenAddress)) {
      setLocalError("The registry does not expose a valid trusted bounty token.");
      return;
    }
    if (!/^\d+$/u.test(bountyAtomic) || BigInt(bountyAtomic) <= 0n) {
      setLocalError("Enter a positive bounty in tUSDT atomic units.");
      return;
    }
    return { token: tokenAddress, amount: BigInt(bountyAtomic) };
  }

  async function approveEscrowToken() {
    setLocalError("");
    if (!registryReady || !patch3qRegistryAddress) {
      setLocalError("Deploy Patch3QRegistry and set VITE_PATCH3Q_REGISTRY_ADDRESS first.");
      return;
    }
    const input = escrowInputs();
    if (!input) return;
    try {
      await tokenWrite.writeContractAsync({
        address: input.token,
        abi: escrowTokenAbi,
        functionName: "approve",
        args: [patch3qRegistryAddress, input.amount],
      });
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not approve the escrow token.");
    }
  }

  async function fundEscrow() {
    setLocalError("");
    if (!bundle || !registryReady || !patch3qRegistryAddress) {
      setLocalError("Load an anchored case and configure the registry first.");
      return;
    }
    const input = escrowInputs();
    if (!input) return;
    try {
      await fundWrite.writeContractAsync({
        address: patch3qRegistryAddress,
        abi: patch3qRegistryAbi,
        functionName: "fundBounty",
        args: [await hashText(bundle.caseId), input.amount],
      });
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not fund the bounty escrow.");
    }
  }

  async function publishRedactedReport() {
    setLocalError("");
    if (!bundle || !registryReady || !patch3qRegistryAddress) {
      setLocalError("Load an anchored case and configure the registry first.");
      return;
    }
    const redacted = redactedReport.trim();
    if (redacted.length < 40) {
      setLocalError("Add a useful redacted report before publishing its commitment.");
      return;
    }
    try {
      await discloseWrite.writeContractAsync({
        address: patch3qRegistryAddress,
        abi: patch3qRegistryAbi,
        functionName: "discloseCase",
        args: [await hashText(bundle.caseId), await hashText(redacted)],
      });
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Could not publish the redacted disclosure commitment.");
    }
  }

  return (
    <section className="workspace anchor-workspace" aria-labelledby="anchor-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Public accountability layer</p>
          <h2 id="anchor-title">Anchor the encrypted receipt</h2>
          <p>Publish hashes and SLA deadlines—not the vulnerability—to QoreChain.</p>
        </div>
        <WalletButton />
      </div>

      <PrivacyLedger bundle={bundle} />

      <div className="anchor-panel">
        <div className="config-row">
          <span>Registry contract</span>
          <code>{registryReady ? shortHash(patch3qRegistryAddress as string) : "Not configured"}</code>
          <span className={registryReady ? "pill positive" : "pill amber"}>{registryReady ? "Ready" : "Deployment needed"}</span>
        </div>
        <div className="config-row">
          <span>Case bundle</span>
          <code>{bundle?.caseId ?? "Seal or verify a bundle first"}</code>
          <span className={bundle ? "pill positive" : "pill amber"}>{bundle ? "Loaded" : "Missing"}</span>
        </div>
        <div className="config-row">
          <span>Reporter authority</span>
          <code>{!bundle?.approvalAuthorities
            ? "Not bound"
            : bundle.privacy.reporterMode === "anonymous"
              ? "No account · per-case key hash only"
              : shortHash(bundle.approvalAuthorities.reporter.evmAddress)}</code>
          <span className={bundle?.approvalAuthorities ? "pill positive" : "pill amber"}>
            {!bundle?.approvalAuthorities ? "Missing" : bundle.privacy.reporterMode === "anonymous" ? "Anonymous" : "Sender bound"}
          </span>
        </div>
        <div className="config-row">
          <span>Program authority</span>
          <code>{bundle?.approvalAuthorities ? shortHash(bundle.approvalAuthorities.program.evmAddress) : "Not bound"}</code>
          <span className={bundle?.approvalAuthorities ? "pill positive" : "pill amber"}>{bundle?.approvalAuthorities ? "ML-DSA bound" : "Missing"}</span>
        </div>
        <div className="config-row">
          <span>Auditor authority</span>
          <code>{bundle?.approvalAuthorities ? shortHash(bundle.approvalAuthorities.auditor.evmAddress) : "Not bound"}</code>
          <span className={bundle?.approvalAuthorities ? "pill positive" : "pill amber"}>{bundle?.approvalAuthorities ? "ML-DSA bound" : "Missing"}</span>
        </div>
        <div className="anchor-note">
          QoreX can read this app, but EVM writes currently require an injected signing wallet and an active QoreChain EVM authorization window.
        </div>
        {(localError || write.error) && <div className="error-callout">{localError || write.error?.message}</div>}
        {write.data && (
          <div className="transaction-status">
            <StatusDot good={receipt.isSuccess} />
            <div><strong>{receipt.isSuccess ? "Receipt anchored" : "Transaction submitted"}</strong><code>{write.data}</code></div>
          </div>
        )}
        <button className="primary-button" type="button" disabled={!bundle || bundle.mode !== "testnet" || !isConnected || write.isPending} onClick={() => void anchor()}>
          {bundle?.mode === "demo"
            ? "Seal in testnet mode to anchor"
            : write.isPending
              ? "Confirm in wallet…"
              : !isConnected
                ? "Connect a signing wallet to anchor"
                : bundle?.privacy.reporterMode === "anonymous"
                  ? "Relay anonymous receipt to QoreChain"
                  : "Anchor receipt on QoreChain"}
        </button>
      </div>

      <div className="section-heading divided">
        <StepMark number="02" active />
        <div><h3>Advance the accountable lifecycle</h3><p>Program actions and SLA breaches are read directly from the registry.</p></div>
      </div>
      <div className="anchor-panel">
        <div className="config-row">
          <span>On-chain status</span>
          <code>{currentStatus === undefined ? "Not anchored or unavailable" : CASE_STATUSES[currentStatus]}</code>
          <span className={currentStatus === undefined ? "pill amber" : "pill positive"}>
            {currentStatus === undefined ? "No state" : "Verified read"}
          </span>
        </div>
        <div className="config-row">
          <span>Acknowledgement SLA</span>
          <code>{caseState ? formatDate(new Date(Number(caseState[4]) * 1000).toISOString()) : "Unavailable"}</code>
          <span className={deadlineRead.data?.[0] ? "pill amber" : "pill positive"}>
            {deadlineRead.data?.[0] ? "Breached" : "Within SLA"}
          </span>
        </div>
        <div className="config-row">
          <span>Triage SLA</span>
          <code>{caseState ? formatDate(new Date(Number(caseState[5]) * 1000).toISOString()) : "Unavailable"}</code>
          <span className={deadlineRead.data?.[1] ? "pill amber" : "pill positive"}>
            {deadlineRead.data?.[1] ? "Breached" : "Within SLA"}
          </span>
        </div>
        <div className="config-row">
          <span>Payment guarantee</span>
          <code>{escrowedAmount > 0n ? `${escrowedAmount.toString()} atomic units escrowed` : "No funded payout"}</code>
          <span className={escrowedAmount > 0n ? "pill positive" : "pill amber"}>
            {escrowedAmount > 0n ? "Escrow at risk" : "Deadlines only"}
          </span>
        </div>
        <div className="anchor-note">
          {connectedIsProgram
            ? "The connected wallet is the bound program authority for this case."
            : "Connect the bound program wallet to acknowledge, triage, or resolve this case."}
        </div>
        <div className="action-stack">
          <button
            className="secondary-button"
            type="button"
            disabled={!connectedIsProgram || currentStatus !== 0 || lifecycleWrite.isPending}
            onClick={() => void advanceLifecycle("acknowledgeCase")}
          >
            Acknowledge case
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!connectedIsProgram || currentStatus !== 1 || lifecycleWrite.isPending}
            onClick={() => void advanceLifecycle("triageCase")}
          >
            Record triage
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!connectedIsProgram || currentStatus !== 2 || lifecycleWrite.isPending}
            onClick={() => void advanceLifecycle("resolveCase")}
          >
            Mark fix resolved
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={
              currentStatus === undefined || currentStatus > 1 ||
              !(deadlineRead.data?.[0] || deadlineRead.data?.[1]) || lifecycleWrite.isPending
            }
            onClick={() => void advanceLifecycle("escalateMissedDeadline")}
          >
            Escalate missed deadline
          </button>
          <button
            className="text-button quiet"
            type="button"
            disabled={currentStatus === undefined || lifecycleWrite.isPending}
            onClick={() => void advanceLifecycle("recordDeadlineBreaches")}
          >
            Record any expired SLA →
          </button>
        </div>
        {lifecycleWrite.data && (
          <div className="transaction-status">
            <StatusDot good={lifecycleReceipt.isSuccess} />
            <div><strong>{lifecycleReceipt.isSuccess ? "Lifecycle updated" : "Lifecycle transaction submitted"}</strong><code>{lifecycleWrite.data}</code></div>
          </div>
        )}
      </div>

      <div className="section-heading divided">
        <StepMark number="03" active />
        <div><h3>Fund the bounty escrow</h3><p>The program wallet approves and deposits the registry-bound tUSDT after the case is anchored.</p></div>
      </div>
      <div className="anchor-panel">
        <div className="form-grid">
          <Field label="Registry-bound bounty token" hint="Immutable after registry deployment." wide>
            <input readOnly value={tokenAddress ?? "Registry not configured"} />
          </Field>
          <Field label="Bounty atomic units" hint="6 decimals: 2500000000 = 2,500 tUSDT." wide>
            <input inputMode="numeric" value={bountyAtomic} onChange={(event) => setBountyAtomic(event.target.value)} />
          </Field>
        </div>
        <div className="anchor-note">
          Until funding confirms, the chain can prove a missed deadline but cannot pay a bounty. After funding, a missed
          SLA permanently replaces the program's approval with the reporter's; the auditor still co-signs.
        </div>
        <div className="action-stack">
          <button className="secondary-button" type="button" disabled={!bundle || !connectedIsProgram || tokenWrite.isPending} onClick={() => void approveEscrowToken()}>
            {tokenWrite.isPending ? "Confirm token approval…" : "1. Approve tUSDT"}
          </button>
          <button className="primary-button" type="button" disabled={!bundle || !connectedIsProgram || fundWrite.isPending} onClick={() => void fundEscrow()}>
            {fundWrite.isPending ? "Confirm escrow deposit…" : "2. Fund case escrow"}
          </button>
        </div>
        {tokenWrite.data && (
          <div className="transaction-status"><StatusDot good={tokenReceipt.isSuccess} /><div><strong>{tokenReceipt.isSuccess ? "Token approved" : "Approval submitted"}</strong><code>{tokenWrite.data}</code></div></div>
        )}
        {fundWrite.data && (
          <div className="transaction-status"><StatusDot good={fundReceipt.isSuccess} /><div><strong>{fundReceipt.isSuccess ? "Escrow funded" : "Funding submitted"}</strong><code>{fundWrite.data}</code></div></div>
        )}
      </div>

      <div className="section-heading divided">
        <StepMark number="04" active />
        <div><h3>Publish after the fix</h3><p>Commit a redacted report after resolution and embargo; exploit material remains encrypted.</p></div>
      </div>
      <div className="anchor-panel">
        <Field label="Redacted public report" hint="Remove working exploit code, secrets, private identities, and unsafe operational detail." wide>
          <textarea rows={8} value={redactedReport} onChange={(event) => setRedactedReport(event.target.value)} placeholder="Summary, affected versions, impact, fix, disclosure timeline…" />
        </Field>
        <div className="action-stack">
          <button className="secondary-button" type="button" disabled={!redactedReport.trim()} onClick={() => downloadText((bundle?.caseId ?? "patch3q") + ".redacted.md", redactedReport, "text/markdown")}>
            ↓ Save redacted report
          </button>
          <button className="primary-button" type="button" disabled={!bundle || !connectedCanDisclose || currentStatus !== 3 || discloseWrite.isPending} onClick={() => void publishRedactedReport()}>
            {discloseWrite.isPending ? "Confirm disclosure…" : "Publish redacted commitment"}
          </button>
        </div>
        {discloseWrite.data && (
          <div className="transaction-status"><StatusDot good={discloseReceipt.isSuccess} /><div><strong>{discloseReceipt.isSuccess ? "Disclosure committed" : "Disclosure submitted"}</strong><code>{discloseWrite.data}</code></div></div>
        )}
      </div>

      <div className="lifecycle">
        {["Submitted", "Acknowledged", "Triaged", "Resolved", "Disclosed"].map((item, index) => (
          <div key={item}><span>{index + 1}</span><strong>{item}</strong></div>
        ))}
      </div>
    </section>
  );
}

function V4Workspace({
  bundle,
  initialVaults,
  payout,
  initialRecoveryNotice,
  onRecovered,
  protocolVersion,
  onProtocolVersionChange,
}: {
  bundle?: Patch3QBundle;
  initialVaults?: Patch3QApprovalVault[];
  payout?: SealedPayout;
  initialRecoveryNotice?: string;
  onRecovered: (bundle: Patch3QBundle, notice: string) => void;
  protocolVersion: 4 | 5;
  onProtocolVersionChange: (version: 4 | 5) => void;
}) {
  const { address, isConnected } = useAccount();
  const protocolName = `V${protocolVersion}`;
  const patch3qRegistryV4Address = protocolVersion === 5 ? patch3qRegistryV5Address : legacyV4Address;
  const patch3qRegistryV4Abi = protocolVersion === 5 ? patch3qRegistryV5Abi : legacyV4Abi;
  const [auditorsText, setAuditorsText] = useState("");
  const [relayersText, setRelayersText] = useState("");
  const [threshold, setThreshold] = useState("2");
  const [reserveAtomic, setReserveAtomic] = useState("2500000000");
  const [maxOpenCases, setMaxOpenCases] = useState("10");
  const [acknowledgeHours, setAcknowledgeHours] = useState("24");
  const [triageHours, setTriageHours] = useState("168");
  const [embargoHours, setEmbargoHours] = useState("720");
  const [decisionGraceSeconds, setDecisionGraceSeconds] = useState("604800");
  const [depositAtomic, setDepositAtomic] = useState("25000000000");
  const [recoverCaseId, setRecoverCaseId] = useState("");
  const [participantRole, setParticipantRole] = useState<"reporter" | "program">("program");
  const [severity, setSeverity] = useState<Severity>("high");
  const [payoutAtomic, setPayoutAtomic] = useState("2500000000");
  const [rationale, setRationale] = useState(bundle?.mode === "demo" ? "Independent auditors verified the synthetic finding and agreed its payout." : "");
  const [participantVaultText, setParticipantVaultText] = useState(() => {
    const vault = initialVaults?.find((entry) => entry.role === "program");
    return vault ? approvalVaultToJson(vault) : "";
  });
  const [auditorVaultsText, setAuditorVaultsText] = useState(() => JSON.stringify(
    initialVaults?.filter((entry) => entry.role === "auditor").slice(0, bundle ? bundleAuditorThreshold(bundle) : 2) ?? [], null, 2,
  ));
  const [approval, setApproval] = useState<V4SeverityApproval>();
  const [verification, setVerification] = useState<V4ApprovalVerificationResult>();
  const [rejection, setRejection] = useState<V5Rejection>();
  const [rejectionVerification, setRejectionVerification] = useState<Awaited<ReturnType<typeof verifyV5Rejection>>>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialRecoveryNotice ?? "");
  const [signing, setSigning] = useState(false);
  const localDemo = bundle?.mode === "demo";
  const policyWrite = useWriteContract();
  const tokenWrite = useWriteContract();
  const poolWrite = useWriteContract();
  const caseWrite = useWriteContract();
  const payoutWrite = useWriteContract();
  const escalationWrite = useWriteContract();
  const rejectionWrite = useWriteContract();
  const registryReady = Boolean(
    patch3qRegistryV4Address && isAddress(patch3qRegistryV4Address) && patch3qRegistryV4Address !== zeroAddress,
  );
  const programAddress = bundle?.approvalAuthorities?.program.evmAddress;
  const policyOwner = address ?? programAddress ?? currentV4Deployment.deployer;
  const caseIdHash = useMemo(() => bundle ? viemSha256(toBytes(bundle.caseId)) : undefined, [bundle]);
  const policyRead = useReadContract({
    address: patch3qRegistryV4Address ?? zeroAddress,
    abi: patch3qRegistryV4Abi,
    functionName: "programPolicyState",
    args: [policyOwner ?? zeroAddress],
    query: { enabled: registryReady && !localDemo && Boolean(policyOwner), retry: false },
  });
  const bundlePolicyRead = useReadContract({
    address: patch3qRegistryV4Address ?? zeroAddress,
    abi: patch3qRegistryV4Abi,
    functionName: "programPolicyState",
    args: [programAddress ?? zeroAddress],
    query: { enabled: registryReady && !localDemo && Boolean(programAddress), retry: false },
  });
  const bundleAuditorsRead = useReadContract({
    address: patch3qRegistryV4Address ?? zeroAddress,
    abi: patch3qRegistryV4Abi,
    functionName: "programAuditors",
    args: [programAddress ?? zeroAddress],
    query: { enabled: registryReady && !localDemo && Boolean(programAddress), retry: false },
  });
  const tokenRead = useReadContract({
    address: patch3qRegistryV4Address ?? zeroAddress,
    abi: patch3qRegistryV4Abi,
    functionName: "bountyToken",
    query: { enabled: registryReady && !localDemo, retry: false },
  });
  const caseRead = useReadContract({
    address: patch3qRegistryV4Address ?? zeroAddress,
    abi: patch3qRegistryV4Abi,
    functionName: "caseState",
    args: [caseIdHash ?? zeroHash],
    query: { enabled: registryReady && !localDemo && Boolean(caseIdHash), retry: false },
  });
  const policy = policyRead.data as readonly [boolean, boolean, bigint, bigint, number, number, number, bigint, bigint, bigint, bigint, bigint] | undefined;
  const caseState = caseRead.data as readonly [number, number, number, bigint, bigint, bigint, bigint, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, number] | undefined;
  const decisionRead = useReadContract({ address: patch3qRegistryV4Address ?? zeroAddress, abi: patch3qRegistryV5Abi,
    functionName: "decisionState", args: [caseIdHash ?? zeroHash], query: { enabled: protocolVersion === 5 && registryReady && !localDemo && Boolean(caseIdHash), retry: false } });
  const decision = protocolVersion === 5 ? decisionRead.data as readonly [bigint, boolean] | undefined : undefined;
  const graceRead = useReadContract({ address: patch3qRegistryV4Address ?? zeroAddress, abi: patch3qRegistryV5Abi,
    functionName: "programDecisionGracePeriod", args: [policyOwner ?? zeroAddress], query: { enabled: protocolVersion === 5 && registryReady && !localDemo, retry: false } });
  const settled = caseState?.[0] === 4 || caseState?.[0] === 6 || Boolean(caseState?.[9] && caseState[9] !== zeroHash);

  function parseAddresses(value: string): `0x${string}`[] {
    const entries = value.split(/[\s,]+/u).map((entry) => entry.trim()).filter(Boolean);
    if (!entries.length || entries.some((entry) => !isAddress(entry))) throw new Error("Enter valid 0x auditor and relayer addresses.");
    if (new Set(entries.map((entry) => entry.toLowerCase())).size !== entries.length) throw new Error("Authority lists cannot contain duplicates.");
    return entries as `0x${string}`[];
  }

  async function configurePolicy() {
    setError(""); setNotice("");
    if (!patch3qRegistryV4Address) return setError("Configure the selected registry address first.");
    try {
      const auditors = parseAddresses(auditorsText);
      const relayers = parseAddresses(relayersText);
      await policyWrite.writeContractAsync({
        address: patch3qRegistryV4Address,
        abi: patch3qRegistryV4Abi,
        functionName: protocolVersion === 5 ? "configureProgramPolicyWithDecisionGrace" : "configureProgramPolicy",
        args: [
          auditors,
          Number(threshold),
          relayers,
          BigInt(reserveAtomic),
          Number(maxOpenCases),
          BigInt(acknowledgeHours) * 3600n,
          BigInt(triageHours) * 3600n,
          BigInt(embargoHours) * 3600n,
          ...(protocolVersion === 5 ? [BigInt(decisionGraceSeconds)] : []),
        ],
      });
      setNotice("Program policy submitted. Refresh after confirmation to read the funded capacity.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not configure the program policy."); }
  }

  async function approvePoolToken() {
    setError("");
    if (!patch3qRegistryV4Address || !tokenRead.data) return setError("The selected registry or its token is unavailable.");
    try {
      await tokenWrite.writeContractAsync({ address: tokenRead.data, abi: escrowTokenAbi, functionName: "approve", args: [patch3qRegistryV4Address, BigInt(depositAtomic)] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Token approval failed."); }
  }

  async function depositPool() {
    setError("");
    if (!patch3qRegistryV4Address) return setError("The selected registry is not configured.");
    try {
      await poolWrite.writeContractAsync({ address: patch3qRegistryV4Address, abi: patch3qRegistryV4Abi, functionName: "depositProgramPool", args: [BigInt(depositAtomic)] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Pool deposit failed."); }
  }

  async function publishBundle() {
    setError(""); setNotice("");
    if (!bundle || !patch3qRegistryV4Address || !programAddress) return setError("Load a bundle with a bound program first.");
    if (bundle.mode !== "testnet" || bundle.privacy.reporterMode !== "anonymous") return setError("Funded publication requires an anonymous testnet bundle.");
    if ((bundle.approvalAuthorities?.auditors?.length ?? 0) < 2) return setError("Seal this case in quorum mode first.");
    try {
      const onchainPolicy = bundlePolicyRead.data as readonly [boolean, boolean, bigint, bigint, number, number, number, bigint, bigint, bigint, bigint, bigint] | undefined;
      const onchainAuditors = bundleAuditorsRead.data as readonly `0x${string}`[] | undefined;
      const boundAuditors = bundle.approvalAuthorities?.auditors?.map((entry) => entry.evmAddress.toLowerCase()) ?? [];
      if (!onchainPolicy?.[0] || !onchainPolicy[1]) throw new Error("The program policy is missing or disabled.");
      if (Number(onchainPolicy[6]) !== bundleAuditorThreshold(bundle)) throw new Error("The bundle threshold does not match the live program policy.");
      if (!onchainAuditors || onchainAuditors.length !== boundAuditors.length || onchainAuditors.some((entry, index) => entry.toLowerCase() !== boundAuditors[index])) {
        throw new Error("The bundle auditor order does not match the live program policy. Reseal against the current policy.");
      }
      const encryptedBundle = await v4BundleHex(bundle);
      if ((encryptedBundle.length - 2) / 2 > 131_072) throw new Error("The full encrypted bundle exceeds the 128 KiB event limit.");
      await caseWrite.writeContractAsync({
        address: patch3qRegistryV4Address,
        abi: patch3qRegistryV4Abi,
        functionName: "submitFundedAnonymousCase",
        args: [
          programAddress,
          await hashText(bundle.caseId),
          bundle.envelopeHash,
          bundle.contentCommitment,
          await hashText(`patch3q:${bundle.caseId}`),
          bundle.privacy.reporterPqKeyHash,
          bundle.privacy.payoutCommitment,
          encryptedBundle,
        ],
      });
      setNotice("The relayer transaction publishes the encrypted bundle and atomically reserves the program bounty.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not publish the funded case."); }
  }

  async function recoverBundle() {
    setError(""); setNotice("");
    if (!patch3qRegistryV4Address || !recoverCaseId.trim()) return setError("Enter a case ID and configure the selected registry.");
    try {
      const deployment = protocolVersion === 5 ? currentV5Deployment : currentV4Deployment;
      const fromBlock = patch3qRegistryV4Address.toLowerCase() === deployment.registryAddress.toLowerCase()
        ? BigInt(deployment.deploymentBlock)
        : undefined;
      const recovered = await fetchV4Bundle({ registryAddress: patch3qRegistryV4Address, caseId: recoverCaseId.trim(), fromBlock });
      const recoveryNotice = `Recovered and SHA-256 verified bundle from ${recovered.transactionHash ?? "the registry event log"}.`;
      onRecovered(recovered.bundle, recoveryNotice);
      setNotice(recoveryNotice);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not recover the encrypted bundle."); }
  }

  function selectParticipant(role: "reporter" | "program") {
    setParticipantRole(role);
    const vault = initialVaults?.find((entry) => entry.role === role);
    setParticipantVaultText(vault ? approvalVaultToJson(vault) : "");
    if (localDemo) {
      setAuditorVaultsText(JSON.stringify(initialVaults?.filter((entry) => entry.role === "auditor").slice(0, bundleAuditorThreshold(bundle!)) ?? [], null, 2));
      setApproval(undefined); setVerification(undefined);
    }
  }

  async function signQuorumApproval() {
    setError(""); setNotice("");
    setRejection(undefined); setRejectionVerification(undefined);
    if (!bundle || !patch3qRegistryV4Address || !payout) return setError("Load the bundle, its decrypted payout, and the selected registry first.");
    setSigning(true); setApproval(undefined); setVerification(undefined);
    try {
      const participant = parseApprovalVault(participantVaultText);
      const parsed = JSON.parse(auditorVaultsText) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Auditor vault input must be a JSON array.");
      const auditorVaults = parsed.map((entry) => parseApprovalVault(JSON.stringify(entry)));
      const next = await createV4QuorumApproval({
        bundle,
        participantRole,
        participant,
        auditors: auditorVaults,
        registryAddress: patch3qRegistryV4Address,
        severity,
        payoutAtomic,
        rationale,
        payout,
      });
      const expectedRole = v4ParticipantRole(localDemo ? undefined : caseState?.[0], participantRole);
      const checked = await verifyV4QuorumApproval(bundle, next, patch3qRegistryV4Address, expectedRole);
      setApproval(next); setVerification(checked);
      setParticipantVaultText(""); setAuditorVaultsText("[]");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the quorum approval."); }
    finally { setSigning(false); }
  }

  async function prepareRejection() {
    setError(""); setRejection(undefined); setRejectionVerification(undefined);
    setApproval(undefined); setVerification(undefined);
    if (!bundle || !patch3qRegistryV4Address || protocolVersion !== 5) return setError("Load a V5 case before preparing a rejection.");
    setSigning(true);
    try {
      const parsed = JSON.parse(auditorVaultsText) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Auditor vault input must be an array.");
      const amount = localDemo ? reserveAtomic : caseState?.[3].toString();
      if (!amount) throw new Error("Refresh the V5 case to read its reserved amount.");
      const packet = await createV5Rejection({ bundle, registryAddress: patch3qRegistryV4Address, reservedAmount: amount,
        rationale, auditors: parsed.map((entry) => parseApprovalVault(JSON.stringify(entry))) });
      const checked = await verifyV5Rejection(bundle, packet, patch3qRegistryV4Address, amount);
      setRejection(packet); setRejectionVerification(checked); setAuditorVaultsText("[]");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not verify rejection quorum."); }
    finally { setSigning(false); }
  }

  async function rejectOnChain() {
    setError("");
    if (localDemo || !rejection || !rejectionVerification?.verified || !caseState || !bundle || !patch3qRegistryV4Address) return setError("Verify a live V5 rejection first.");
    try {
      const checked = await verifyV5Rejection(bundle, rejection, patch3qRegistryV4Address, caseState[3].toString());
      if (!checked.verified) throw new Error("The rejection no longer matches the loaded case or reserve.");
      await rejectionWrite.writeContractAsync({ address: patch3qRegistryV4Address, abi: patch3qRegistryV5Abi,
        functionName: "rejectAnonymousCase", args: [caseIdHash, rejection.statement.rationaleHash,
          rejection.auditors.map((entry) => entry.evmAddress), rejection.auditors.map((entry) => bytesToHex(fromBase64(entry.signature.pq!.signature)))] });
      setNotice("Quorum rejection submitted. Confirm its receipt, then refresh to see the returned reserve and released capacity.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Rejection failed."); }
  }

  async function escalateCase() {
    setError("");
    if (localDemo || !caseIdHash || !patch3qRegistryV4Address) return setError("Load a live case first.");
    try {
      await escalationWrite.writeContractAsync({ address: patch3qRegistryV4Address, abi: patch3qRegistryV4Abi,
        functionName: "escalateMissedDeadline", args: [caseIdHash] });
      setNotice("Escalation submitted. Confirm the receipt and refresh; the reporter replaces the program after escalation.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Escalation failed."); }
  }

  async function refreshQuorumState() {
    await Promise.all([policyRead.refetch(), caseRead.refetch(), decisionRead.refetch(), graceRead.refetch(), tokenRead.refetch()]);
  }

  async function releaseV4Payout() {
    setError("");
    if (!bundle || !approval || !verification?.verified || !patch3qRegistryV4Address) return setError("Verify a complete quorum approval first.");
    const participantPq = approval.participant.signature.pq?.signature;
    const auditorPq = approval.auditors.map((entry) => entry.signature.pq?.signature);
    const reporterKey = bundle.approvalAuthorities?.reporter.pqPublicKey;
    const recipient = approval.statement.payout.recipient;
    const salt = approval.statement.payout.commitmentSalt;
    if (!participantPq || auditorPq.some((entry) => !entry) || !recipient || !salt) return setError("The approval is missing a required PQ signature or payout opening.");
    try {
      await payoutWrite.writeContractAsync({
        address: patch3qRegistryV4Address,
        abi: patch3qRegistryV4Abi,
        functionName: "approveAnonymousSeverity",
        args: [
          await hashText(bundle.caseId),
          SEVERITY_CODES[approval.statement.severity],
          BigInt(approval.statement.payout.atomic),
          approval.statement.rationaleHash,
          recipient,
          salt,
          approval.participantRole === "reporter" && reporterKey ? bytesToHex(fromBase64Url(reporterKey)) : "0x",
          bytesToHex(fromBase64(participantPq)),
          approval.auditors.map((entry) => entry.evmAddress),
          auditorPq.map((entry) => bytesToHex(fromBase64(entry!))),
        ],
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not release the payout."); }
  }

  return (
    <section className="workspace" aria-labelledby="v4-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">{protocolName} funded bounty workspace</p>
          <h2 id="v4-title">Pre-funded pools, durable delivery, and auditor quorum</h2>
          <p>Configure capacity before reports arrive; each accepted case atomically reserves funds and snapshots a 2-of-3 auditor set.</p>
        </div>
        <WalletButton />
      </div>

      <div className="form-grid"><Field label="Registry version"><select value={protocolVersion} onChange={(event) => { onProtocolVersionChange(Number(event.target.value) as 4 | 5); setApproval(undefined); setVerification(undefined); setRejection(undefined); setRejectionVerification(undefined); setError(""); setNotice(""); }}><option value="5">V5 — decision deadlines and rejection</option><option value="4">V4 — preserved deployment</option></select></Field><div className="config-row"><span>Registry</span><code>{patch3qRegistryV4Address ?? "Not configured"}</code></div></div>

      {localDemo && <div className="warning-callout" role="note"><strong>Local quorum demo</strong><span>This synthetic report uses real browser encryption and signatures. Verify a program-led approval, then select Reporter after escalation to verify the alternative authority. This demo sends no transaction.</span></div>}
      {!registryReady && <div className="warning-callout"><strong>{protocolName} deployment is not configured.</strong><span>Set <code>{`VITE_PATCH3Q_${protocolName}_REGISTRY_ADDRESS`}</code> to the selected deployment. Local 2-of-3 signing remains testable in demo mode.</span></div>}

      <div hidden={localDemo}>
      <div className="section-heading divided"><StepMark number="01" active /><div><h3>Program policy and pool</h3><p>Only registered PQ accounts can become program, auditor, or relayer authorities.</p></div></div>
      <div className="anchor-panel">
        <div className="form-grid">
          <Field label="Auditor EVM addresses" hint="Up to five; separate with commas or new lines." wide><textarea rows={3} value={auditorsText} onChange={(event) => setAuditorsText(event.target.value)} placeholder={"0x…\n0x…\n0x…"} /></Field>
          <Field label="Authorized relayer addresses" wide><textarea rows={2} value={relayersText} onChange={(event) => setRelayersText(event.target.value)} placeholder="0x…" /></Field>
          <Field label="Auditor threshold"><input inputMode="numeric" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></Field>
          <Field label="Maximum open cases"><input inputMode="numeric" value={maxOpenCases} onChange={(event) => setMaxOpenCases(event.target.value)} /></Field>
          <Field label="Reserve per case (atomic)"><input inputMode="numeric" value={reserveAtomic} onChange={(event) => setReserveAtomic(event.target.value)} /></Field>
          <Field label="Acknowledgement hours"><input inputMode="numeric" value={acknowledgeHours} onChange={(event) => setAcknowledgeHours(event.target.value)} /></Field>
          <Field label="Triage hours"><input inputMode="numeric" value={triageHours} onChange={(event) => setTriageHours(event.target.value)} /></Field>
          <Field label="Embargo hours"><input inputMode="numeric" value={embargoHours} onChange={(event) => setEmbargoHours(event.target.value)} /></Field>
          {protocolVersion === 5 && <Field label="Decision grace (seconds)" hint="Applies only to new cases; seven days is 604800 seconds."><input inputMode="numeric" value={decisionGraceSeconds} onChange={(event) => setDecisionGraceSeconds(event.target.value)} /></Field>}
        </div>
        <button className="primary-button verify-button" type="button" disabled={localDemo || !registryReady || !isConnected || policyWrite.isPending} onClick={() => void configurePolicy()}>{policyWrite.isPending ? "Confirm policy…" : `Configure ${protocolName} program policy`}</button>
        {policy && <div className="receipt-grid v4-state-grid">
          <div><span>Policy</span><strong>{policy[0] ? policy[1] ? "Enabled" : "Paused" : "Not configured"}</strong></div>
          <div><span>Pool available</span><strong>{policy[2].toString()} atomic</strong></div>
          <div><span>Reserved capacity</span><strong>{policy[5]}/{policy[4]} open cases</strong></div>
          <div><span>Quorum</span><strong>{policy[6]} of {policy[7].toString()} auditors</strong></div>
        </div>}
        {protocolVersion === 5 && graceRead.data !== undefined && <p className="field-hint">Configured decision grace: {String(graceRead.data)} seconds after the triage deadline.</p>}
        <div className="form-grid recipient-addresses"><Field label="Pool deposit (atomic)" wide><input inputMode="numeric" value={depositAtomic} onChange={(event) => setDepositAtomic(event.target.value)} /></Field></div>
        <div className="action-stack">
          <button className="secondary-button" type="button" disabled={localDemo || !registryReady || !isConnected || tokenWrite.isPending} onClick={() => void approvePoolToken()}>1. Approve pool token</button>
          <button className="primary-button" type="button" disabled={localDemo || !registryReady || !isConnected || poolWrite.isPending} onClick={() => void depositPool()}>2. Deposit program pool</button>
        </div>
      </div>

      <div className="section-heading divided"><StepMark number="02" active /><div><h3>Publish or recover encrypted delivery</h3><p>The exact bundle bytes live in QoreChain event logs; their SHA-256 is part of the case receipt.</p></div></div>
      <div className="anchor-panel">
        <div className="config-row"><span>Loaded case</span><code>{bundle?.caseId ?? "No bundle loaded"}</code><span className={bundle?.approvalAuthorities?.auditors?.length ? "pill positive" : "pill amber"}>{bundle?.approvalAuthorities?.auditors?.length ? `${bundleAuditorThreshold(bundle)}-of-${bundle.approvalAuthorities.auditors.length}` : "Auditor quorum missing"}</span></div>
        <button className="primary-button" type="button" disabled={localDemo || !registryReady || !isConnected || !bundle || caseWrite.isPending} onClick={() => void publishBundle()}>{caseWrite.isPending ? "Publishing encrypted bundle…" : "Relay, reserve, and publish case"}</button>
        <div className="form-grid recipient-addresses"><Field label="Recover by case ID" wide><div className="wallet-field"><input value={recoverCaseId} onChange={(event) => setRecoverCaseId(event.target.value)} placeholder="P3Q-…" /><button className="secondary-button" type="button" onClick={() => void recoverBundle()}>Recover &amp; verify</button></div></Field></div>
        {caseState && <div className="receipt-grid v4-state-grid"><div><span>On-chain status</span><strong>{protocolVersion === 5 && caseState[0] === 6 ? "Rejected" : v4CaseStatus(caseState[0])}</strong></div><div><span>Reserved bounty</span><strong>{caseState[3].toString()} atomic</strong></div><div><span>Auditor threshold</span><strong>{caseState[12]}</strong></div><div><span>Bundle hash</span><strong>{shortHash(caseState[11])}</strong></div></div>}
        {decision && <div className="config-row"><span>Decision deadline</span><strong>{formatDate(new Date(Number(decision[0]) * 1000).toISOString())}</strong><span className={decision[1] ? "pill amber" : "pill positive"}>{decision[1] ? "Missed — escalate" : "Recorded"}</span></div>}
        <div className="action-stack"><button className="secondary-button" type="button" disabled={localDemo || !registryReady} onClick={() => void refreshQuorumState()}>Refresh chain state</button><button className="primary-button" type="button" disabled={localDemo || !isConnected || !caseState || settled || caseState[0] === 5 || escalationWrite.isPending} onClick={() => void escalateCase()}>Escalate missed deadline</button></div>
      </div>

      </div>
      <div id="quorum-review" className="section-heading divided"><StepMark number="03" active /><div><h3>Collect quorum and release</h3><p>Program + quorum approves normal payout; reporter + quorum replaces the program after escalation.</p></div></div>
      <div className="anchor-panel">
        <div className="form-grid">
          <Field label="Participant"><select value={participantRole} onChange={(event) => selectParticipant(event.target.value as "reporter" | "program")}><option value="program">Program</option><option value="reporter">Reporter after escalation</option></select></Field>
          <Field label="Final severity"><select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="informational">Informational</option></select></Field>
          <Field label="Payout atomic units"><input value={payoutAtomic} onChange={(event) => setPayoutAtomic(event.target.value)} /></Field>
          <Field label="Rationale" wide><textarea rows={3} value={rationale} onChange={(event) => setRationale(event.target.value)} /></Field>
          <details className="field wide" open={!localDemo}><summary>{localDemo ? "Demo signing keys — generated locally" : "Approval signing vaults"}</summary><Field label="Participant approval vault" wide><textarea rows={5} value={participantVaultText} onChange={(event) => setParticipantVaultText(event.target.value)} placeholder="Patch3Q participant approval vault JSON" /></Field><Field label="Auditor approval vault array" hint="Only threshold-many unique auditors are required." wide><textarea rows={8} value={auditorVaultsText} onChange={(event) => setAuditorVaultsText(event.target.value)} placeholder="[auditorVault1, auditorVault2]" /></Field></details>
        </div>
        <button className="primary-button verify-button" type="button" disabled={!bundle || !payout || !participantVaultText || !auditorVaultsText || !registryReady || signing || settled} onClick={() => void signQuorumApproval()}>{signing ? "Verifying quorum…" : "Create & verify quorum approval"}</button>
        {approval && verification && <div className={verification.verified ? "verification-result verified" : "verification-result failed"}>
          <div className="verification-head"><div className="verified-mark">{verification.verified ? "✓" : "!"}</div><div><p className="eyebrow">{approval.participantRole} + {approval.auditors.length} unique auditors</p><h3>{verification.verified ? `${protocolName} payout quorum verified` : "Quorum rejected"}</h3></div></div>
          <div className="check-grid">{Object.entries(verification.checks).map(([name, passed]) => <div key={name}><StatusDot good={passed} /><span>{name.replace(/([A-Z])/g, " $1")}</span><strong>{passed ? "Pass" : "Fail"}</strong></div>)}</div>
          <HashRow label={`${protocolName} approval commitment`} value={approval.approvalHash} />
          <div className="action-stack"><button className="secondary-button" type="button" onClick={() => downloadText(`${bundle!.caseId}.quorum-approval.json`, v4ApprovalToJson(approval))}>↓ Download quorum approval</button><button className="primary-button" type="button" disabled={bundle?.mode !== "testnet" || !verification.verified || !isConnected || payoutWrite.isPending || settled} onClick={() => void releaseV4Payout()}>Release reserved bounty</button></div>
        </div>}
      </div>
      {protocolVersion === 5 && <div className="anchor-panel">
        <div className="section-heading divided"><StepMark number="04" active /><div><h3>Reject an invalid report</h3><p>The auditor quorum can return the full reserve without a program or reporter veto. Use the rationale and auditor vaults above; rejection transfers no bounty.</p></div></div>
        <button className="secondary-button" type="button" disabled={!bundle || signing || settled || !auditorVaultsText || auditorVaultsText === "[]"} onClick={() => void prepareRejection()}>Create &amp; verify rejection quorum</button>
        {rejection && rejectionVerification && <div className={rejectionVerification.verified ? "verification-result verified" : "verification-result failed"}><div className="verification-head"><div className="verified-mark">{rejectionVerification.verified ? "✓" : "!"}</div><div><p className="eyebrow">Auditor quorum only</p><h3>{rejectionVerification.verified ? "V5 rejection quorum verified" : "Rejection quorum failed"}</h3></div></div><div className="check-grid">{Object.entries(rejectionVerification.checks).map(([name, passed]) => <div key={name}><StatusDot good={passed} /><span>{name.replace(/([A-Z])/g, " $1")}</span><strong>{passed ? "Pass" : "Fail"}</strong></div>)}</div><HashRow label="Rejection commitment" value={rejection.rejectionHash} /><div className="action-stack"><button className="secondary-button" type="button" onClick={() => downloadText(`${bundle!.caseId}.v5-rejection.json`, JSON.stringify(rejection, null, 2))}>↓ Download rejection verdict</button><button className="primary-button" type="button" disabled={localDemo || !isConnected || !rejectionVerification.verified || rejectionWrite.isPending || settled} onClick={() => void rejectOnChain()}>Reject case &amp; return reserve</button></div></div>}
      </div>}
      {error && <div className="error-callout" role="alert">{error}</div>}
      {notice && <div className="transaction-status"><StatusDot good /><div><strong>{notice}</strong></div></div>}
    </section>
  );
}

function LiveEvidence() {
  return (
    <a
      className="live-evidence"
      href={"https://dashboard.qorechain.io/explorer/address/" + currentV5Deployment.registryAddress}
      target="_blank"
      rel="noreferrer"
    >
      <i /> V5 live on Diana · View the registry ↗
    </a>
  );
}

export function App() {
  const [showDeadlineCase, setShowDeadlineCase] = useState(window.location.hash === "#missed-deadline");
  const [workspace, setWorkspace] = useState<Workspace>("seal");
  const [quorumVersion, setQuorumVersion] = useState<4 | 5>(5);
  const [latestResult, setLatestResult] = useState<SealResult>();
  const [verifyBundle, setVerifyBundle] = useState<Patch3QBundle>();
  const [verifyVault, setVerifyVault] = useState<Patch3QKeyVault>();
  const [latestApproval, setLatestApproval] = useState<SeverityApproval>();
  const [latestPayout, setLatestPayout] = useState<SealedPayout>();
  const [lastRecovery, setLastRecovery] = useState<{ caseId: string; version: 4 | 5; notice: string }>();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState("");
  const anchorBundle = latestResult?.bundle ?? verifyBundle;
  const workspaceLabel = useMemo(() => {
    if (workspace === "seal") return "Create";
    if (workspace === "verify") return "Verify";
    if (workspace === "approve") return "Approve";
    if (workspace === "v4") return "Pool & quorum";
    return "Anchor";
  }, [workspace]);

  function openVerification(bundle: Patch3QBundle, vault: Patch3QKeyVault) {
    setVerifyBundle(bundle);
    setVerifyVault(vault);
    setWorkspace("verify");
    window.scrollTo({ top: 420, behavior: "smooth" });
  }

  async function startQuorumDemo() {
    setDemoBusy(true); setDemoError("");
    try {
      const result = await sealReport({ report: { ...QORECHAIN_DEMO_REPORT, embargoUntil: localDateAfter(30) },
        mode: "demo", reporterMode: "anonymous", demoAuditorCount: 3, auditorThreshold: 2,
        payoutAddress: privateKeyToAccount(generatePrivateKey()).address });
      const opened = await openBundle(result.bundle, result.vaults[0]);
      if (!opened.verified || !opened.payload.payout) throw new Error("The independent recipient check failed.");
      setLatestResult(result); setLatestPayout(opened.payload.payout); setLatestApproval(undefined);
      setWorkspace("v4");
      setQuorumVersion(5);
      window.requestAnimationFrame(() => document.getElementById("quorum-review")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    } catch (caught) { setDemoError(caught instanceof Error ? caught.message : "Could not start the quorum demo."); }
    finally { setDemoBusy(false); }
  }

  useEffect(() => {
    if (!showDeadlineCase) return;
    const proof = document.getElementById("missed-deadline");
    proof?.focus({ preventScroll: true });
    proof?.scrollIntoView({ block: "start" });
  }, [showDeadlineCase]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#" aria-label="Patch3Q home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>Patch3Q</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#threat-model">Threat model</a>
          <a href="https://qorechain.io/security" target="_blank" rel="noreferrer">QoreChain bounty ↗</a>
        </nav>
        <span className="network-badge" title="Diana testnet" aria-label="Diana testnet">
          <i /><span>Diana testnet</span>
        </span>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-kicker">Post-quantum bug bounties</div>
            <h1>Private bug reports.<br /><em>Funded bounties.</em></h1>
            <p>
              Report a bug anonymously. Participating programs reserve the bounty upfront. If a program misses its
              deadline, the researcher takes over its payout vote. Auditors still judge the claim.
            </p>
            <div className="hero-actions">
              <a id="open-deadline-case" href="#missed-deadline" className="primary-button" onClick={() => setShowDeadlineCase(true)}>See a missed-deadline payout</a>
              <a href="#workspace" className="secondary-button" onClick={() => setWorkspace("seal")}>Write a report</a>
            </div>
            <div className="hero-proof">
              <div><strong>ML-KEM-1024</strong><span>Sealed in your browser</span></div>
              <div><strong>2-of-3 ML-DSA</strong><span>No single-auditor lockout</span></div>
              <div><strong>No reporter wallet</strong><span>In anonymous mode</span></div>
            </div>
            <LiveEvidence />
            <div className="guarantee-card" role="note" aria-label="Scope of Patch3Q's payment guarantee">
              <strong>What the chain guarantees</strong>
              <span>Pre-funded case + missed SLA → the program permanently loses its approval vote.</span>
              <small>V5 reserves the bounty at submission and records a final decision deadline; the auditor quorum co-signs.</small>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="quantum-card card-one"><span>REPORT</span><i>████ ██████</i><i>██████ ███</i><i>███ ███████</i></div>
            <div className="quantum-card card-two"><span>SEALED</span><strong>ML-KEM</strong><small>1024</small></div>
            <div className="quantum-core"><span className="core-lock">◇</span><i /><i /><i /></div>
            <div className="recipient-node node-one"><b>M</b><span>Maintainer</span></div>
            <div className="recipient-node node-two"><b>A</b><span>Auditor</span></div>
          </div>
        </section>

        {showDeadlineCase && (
          <DeadlineCase
            demoBusy={demoBusy}
            demoError={demoError}
            onTrySigning={() => void startQuorumDemo()}
          />
        )}

        <section id="workspace" className="workspace-shell">
          <div className="workspace-tabs" role="tablist" aria-label="Patch3Q workspace">
            {([
              ["seal", "01", "Seal report"],
              ["verify", "02", "Verify & open"],
              ["anchor", "03", "Anchor & escrow"],
              ["approve", "04", "Approve bounty"],
              ["v4", "05", "Pool & quorum"],
            ] as const).map(([id, number, label]) => (
              <button key={id} type="button" role="tab" aria-selected={workspace === id} className={workspace === id ? "active" : ""} onClick={() => setWorkspace(id)}>
                <span>{number}</span>{label}
              </button>
            ))}
            <span className="current-workspace">{workspaceLabel} workspace</span>
          </div>
          {workspace === "seal" && <SealWorkspace onResult={(result) => { setLatestResult(result); setLatestApproval(undefined); setLatestPayout(result.payout); }} onVerify={openVerification} />}
          {workspace === "verify" && <VerifyWorkspace key={(verifyBundle?.caseId ?? "empty") + (verifyVault?.role ?? "")} initialBundle={verifyBundle} initialVault={verifyVault} onBundle={setVerifyBundle} onPayout={setLatestPayout} />}
          {workspace === "approve" && (
            <ApprovalWorkspace
              key={(anchorBundle?.caseId ?? "empty") + (latestResult?.approvalVaults?.map((vault) => vault.signer).join("") ?? "")}
              bundle={anchorBundle}
              initialVaults={latestResult?.approvalVaults}
              initialApproval={latestApproval}
              onApproval={setLatestApproval}
              payout={latestPayout}
            />
          )}
          {workspace === "anchor" && <AnchorWorkspace bundle={anchorBundle} />}
          {workspace === "v4" && (
            <V4Workspace
              protocolVersion={quorumVersion}
              onProtocolVersionChange={setQuorumVersion}
              key={(anchorBundle?.caseId ?? "empty") + (latestResult?.approvalVaults?.map((vault) => vault.signer).join("") ?? "")}
              bundle={anchorBundle}
              initialVaults={latestResult?.approvalVaults}
              payout={latestPayout}
              initialRecoveryNotice={lastRecovery?.caseId === anchorBundle?.caseId && lastRecovery?.version === quorumVersion ? lastRecovery.notice : undefined}
              onRecovered={(bundle, notice) => {
                setLatestResult(undefined);
                setLatestPayout(undefined);
                setVerifyBundle(bundle);
                setLatestApproval(undefined);
                setLastRecovery({ caseId: bundle.caseId, version: quorumVersion, notice });
              }}
            />
          )}
        </section>

        <section className="how-section" id="how-it-works">
          <p className="eyebrow">A disclosure protocol, not another scanner</p>
          <h2>Evidence stays private. Accountability becomes public.</h2>
          <div className="how-grid">
            <article><span>01</span><div className="how-icon">⌁</div><h3>Compose locally</h3><p>The report, PoC, and researcher alias never leave the browser in plaintext.</p></article>
            <article><span>02</span><div className="how-icon">◇</div><h3>Seal twice</h3><p>One post-quantum envelope opens independently for the maintainer and auditor.</p></article>
            <article><span>03</span><div className="how-icon">#</div><h3>Commit evidence</h3><p>A salted content commitment proves later disclosure matches the original report.</p></article>
            <article><span>04</span><div className="how-icon">Q</div><h3>Track the SLA</h3><p>QoreChain records acknowledgement, triage, resolution, and embargo milestones.</p></article>
          </div>
        </section>

        <section className="threat-strip">
          <div><p className="eyebrow">The ghosted-researcher test</p><h2>A funded deadline has a consequence.</h2></div>
          <div className="threat-list">
            <span><StatusDot good /> Anyone can enforce an expired SLA</span>
            <span><StatusDot good /> The case enters Escalated on-chain</span>
            <span><StatusDot good /> Any configured auditor quorum can adjudicate</span>
          </div>
          <p>A researcher, auditor, or keeper submits deadline enforcement. Participating programs fund a pool before accepting reports; V5 snapshots multiple auditors so one unavailable signer cannot freeze payout.</p>
        </section>

        <section className="threat-strip" id="threat-model">
          <div><p className="eyebrow">Explicit threat model</p><h2>Designed to reveal as little as possible.</h2></div>
          <div className="threat-list">
            <span><StatusDot good /> Harvest-now-decrypt-later resistance</span>
            <span><StatusDot good /> Independent recovery path</span>
            <span><StatusDot good /> Ciphertext tamper detection</span>
            <span><StatusDot good /> No custody backend</span>
          </div>
          <p>Anonymous mode hides who reported and where the bounty goes until payout; padding hides report size. Timing, deadlines, the program, auditor and relayer accounts, and the payout amount stay public.</p>
        </section>
      </main>

      <footer>
        <a className="brand footer-brand" href="#"><span className="brand-mark"><i /><i /><i /></span><span>Patch3Q</span></a>
        <p>Responsible disclosure receipts for the Q-Day era.</p>
        <span>Built on QoreChain · QoreSeal 0.1</span>
      </footer>
    </div>
  );
}
