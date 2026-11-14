import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useMemo, useState } from "react";
import { isAddress, sha256 as viemSha256, toBytes, zeroAddress, zeroHash } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { escrowTokenAbi, patch3qRegistryAbi, patch3qRegistryAddress, testnetEvidence } from "./contract.js";
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
} from "./types.js";
import "./styles.css";

type Workspace = "seal" | "verify" | "approve" | "anchor";

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
          <li>Program, auditor and relayer accounts</li>
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
                : "Encrypted for the recipients only; the chain sees a commitment until the bounty is paid."}
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
              <div><strong>Independent auditor</strong><span>Escalation and SLA witness</span></div>
              <span className="pill">Generated on seal</span>
            </div>
          </div>
        ) : (
          <div className="form-grid recipient-addresses">
            {reporterMode === "account" && (
              <Field label="Reporter QoreChain account" hint="This wallet is authenticated inside the sealed bundle." wide>
                <div className="wallet-field">
                  <input readOnly value={reporterAddress ?? "Connect the reporter wallet"} />
                  <ConnectButton />
                </div>
              </Field>
            )}
            <Field label="Maintainer QoreChain address" wide>
              <input required value={maintainerAddress} onChange={(event) => setMaintainerAddress(event.target.value)} placeholder="qor1… or 0x…" />
            </Field>
            <Field label="Auditor QoreChain address" hint="Required for independent recovery and ML-DSA approval." wide>
              <input required value={auditorAddress} onChange={(event) => setAuditorAddress(event.target.value)} placeholder="qor1… or 0x…" />
            </Field>
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
        <ConnectButton />
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

          {(participantRole === "reporter" ? initialReporterVault : initialProgramVault) || participantVaultText ? (
            <details className="paste-fallback" open={!(participantRole === "reporter" ? initialReporterVault : initialProgramVault)}>
              <summary>{participantRole === "reporter" ? "Reporter" : "Program"} approval vault</summary>
              <textarea value={participantVaultText} onChange={(event) => setParticipantVaultText(event.target.value)} placeholder={`Patch3Q ${participantRole} approval vault JSON`} rows={6} />
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
              <textarea value={auditorVaultText} onChange={(event) => setAuditorVaultText(event.target.value)} placeholder="Patch3Q auditor approval vault JSON" rows={6} />
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
  const connectedIsProgram = Boolean(
    address && caseState && address.toLowerCase() === caseState[8].toLowerCase(),
  );
  const connectedIsParticipant = Boolean(
    address && caseState &&
    (address.toLowerCase() === caseState[7].toLowerCase() || address.toLowerCase() === caseState[8].toLowerCase()),
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
        <ConnectButton />
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
          Connect the program wallet. First approve the exact amount, then deposit it into the case escrow.
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
          <button className="primary-button" type="button" disabled={!bundle || !connectedIsParticipant || currentStatus !== 3 || discloseWrite.isPending} onClick={() => void publishRedactedReport()}>
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

function LiveEvidence() {
  if (testnetEvidence.status !== "verified" || !testnetEvidence.registryAddress) {
    return <div className="live-evidence pending"><i /> Diana testnet deployment pending — run <code>pnpm testnet:e2e</code></div>;
  }
  const transactions = Object.values(testnetEvidence.cases ?? {}).reduce(
    (total, entry) => total + Object.keys(entry.transactions ?? {}).length,
    0,
  );
  return (
    <a
      className="live-evidence"
      href={"https://dashboard.qorechain.io/explorer/address/" + testnetEvidence.registryAddress}
      target="_blank"
      rel="noreferrer"
    >
      <i /> Live on Diana · registry {shortHash(testnetEvidence.registryAddress)} · {transactions} verified case transactions ↗
    </a>
  );
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>("seal");
  const [latestResult, setLatestResult] = useState<SealResult>();
  const [verifyBundle, setVerifyBundle] = useState<Patch3QBundle>();
  const [verifyVault, setVerifyVault] = useState<Patch3QKeyVault>();
  const [latestApproval, setLatestApproval] = useState<SeverityApproval>();
  const [latestPayout, setLatestPayout] = useState<SealedPayout>();
  const anchorBundle = latestResult?.bundle ?? verifyBundle;
  const workspaceLabel = useMemo(() => {
    if (workspace === "seal") return "Create";
    if (workspace === "verify") return "Verify";
    if (workspace === "approve") return "Approve";
    return "Anchor";
  }, [workspace]);

  function openVerification(bundle: Patch3QBundle, vault: Patch3QKeyVault) {
    setVerifyBundle(bundle);
    setVerifyVault(vault);
    setWorkspace("verify");
    window.scrollTo({ top: 420, behavior: "smooth" });
  }

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
        <span className="network-badge"><i /> Diana testnet</span>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-kicker"><span>Q</span> Built for the post-quantum disclosure era</div>
            <h1>Report the flaw.<br /><em>Not the secret.</em></h1>
            <p>
              Post-quantum bug-bounty escrow. Seal a vulnerability for the vendor and an independent auditor,
              prove on QoreChain when you reported it, and get paid by two ML-DSA-87 signatures — even if the
              vendor ghosts you. No wallet, no identity, no plaintext.
            </p>
            <div className="hero-proof">
              <div><strong>ML-KEM-1024</strong><span>Sealed in your browser</span></div>
              <div><strong>2 × ML-DSA-87</strong><span>Verified on-chain to pay</span></div>
              <div><strong>0 identity</strong><span>Anonymous reporter mode</span></div>
            </div>
            <LiveEvidence />
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

        <section className="workspace-shell">
          <div className="workspace-tabs" role="tablist" aria-label="Patch3Q workspace">
            {([
              ["seal", "01", "Seal report"],
              ["verify", "02", "Verify & open"],
              ["anchor", "03", "Anchor & escrow"],
              ["approve", "04", "Approve bounty"],
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
          <div><p className="eyebrow">The ghosted-researcher test</p><h2>A deadline has a consequence.</h2></div>
          <div className="threat-list">
            <span><StatusDot good /> Anyone can enforce an expired SLA</span>
            <span><StatusDot good /> The case enters Escalated on-chain</span>
            <span><StatusDot good /> The auditor can adjudicate pre-funded escrow</span>
          </div>
          <p>QoreChain cannot wake itself up on a timer: a researcher, auditor, or keeper submits the enforcement transaction after the deadline.</p>
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
