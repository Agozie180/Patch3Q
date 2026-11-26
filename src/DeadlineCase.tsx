import { useEffect, useState } from "react";
import { formatUnits, parseEventLogs, type Hex, type TransactionReceipt } from "viem";
import lifecycle from "../evidence/v5-lifecycle.json";
import { currentV5Deployment, patch3qRegistryV5Abi } from "./contract.js";
import { publicClient } from "./wallet.js";

const scenario = lifecycle.cases["decision-ghost"];
const receipts = [
  lifecycle.transactions["decision-ghost.submit"],
  lifecycle.transactions["decision-ghost.triage"],
  lifecycle.transactions["decision-ghost.escalate"],
  lifecycle.transactions["decision-ghost.release"],
] as const;
const registry = currentV5Deployment.registryAddress.toLowerCase();
const tokenDecimals = 6;

function readCaseEvents(receipt: TransactionReceipt) {
  if (receipt.status !== "success" || receipt.to?.toLowerCase() !== registry) {
    throw new Error("The receipt did not confirm a successful transaction to this registry.");
  }
  return parseEventLogs({
    abi: patch3qRegistryV5Abi,
    logs: receipt.logs.filter((log) => log.address.toLowerCase() === registry),
  }).filter((event) => "caseIdHash" in event.args && event.args.caseIdHash === scenario.caseIdHash);
}

async function verifiesDeadlineCase(): Promise<boolean> {
  const [chainId, [submission, triage, escalation, payout]] = await Promise.all([
    publicClient.getChainId(),
    Promise.all(receipts.map(async (entry) => readCaseEvents(
      await publicClient.getTransactionReceipt({ hash: entry.hash as Hex }),
    ))),
  ]);
  return chainId === 9800
    && submission.some((event) => event.eventName === "FundedAnonymousCaseSubmitted" && event.args.reservedAmount === BigInt(scenario.payoutAmount) && event.args.auditorThreshold === 2)
    && submission.some((event) => event.eventName === "DecisionDeadlineSet" && event.args.decisionBy === BigInt(scenario.deadlines.decisionBy))
    && triage.some((event) => event.eventName === "CaseTriaged" && event.args.timestamp <= BigInt(scenario.deadlines.triageBy))
    && escalation.some((event) => event.eventName === "CaseEscalated" && event.args.breach === 4 && event.args.timestamp > BigInt(scenario.deadlines.decisionBy))
    && payout.some((event) => event.eventName === "QuorumApprovalRecorded" && event.args.auditorApprovals === 2 && event.args.approvalHash === scenario.approvalHash)
    && payout.some((event) => event.eventName === "BountyReleased" && event.args.amount === BigInt(scenario.payoutAmount) && event.args.recipient.toLowerCase() === scenario.payoutRecipient.toLowerCase());
}

const bounty = new Intl.NumberFormat("en").format(Number(formatUnits(BigInt(scenario.payoutAmount), tokenDecimals)));

const milestones = [
  { title: "Report accepted; bounty reserved", detail: `${bounty} tUSDT set aside. The browser had already encrypted the report.`, receipt: "View reservation" },
  { title: "Program reviewed the report", detail: "The program acknowledged and triaged the case on time.", receipt: "View triage" },
  { title: "Final deadline missed", detail: "A transaction escalated the case. The researcher took the program’s place as a payout signer.", receipt: "View escalation" },
  { title: `${bounty} tUSDT paid`, detail: "The researcher and two auditors signed. The contract paid the researcher’s committed address.", receipt: "View payout" },
] as const;

export function DeadlineCase({ demoBusy, demoError, onTrySigning }: {
  demoBusy: boolean;
  demoError: string;
  onTrySigning: () => void;
}) {
  const [verification, setVerification] = useState<"checking" | "confirmed" | "unavailable" | "mismatch">("checking");
  useEffect(() => {
    let active = true;
    void verifiesDeadlineCase().then((verified) => {
      if (active) setVerification(verified ? "confirmed" : "mismatch");
    }).catch(() => {
      if (active) setVerification("unavailable");
    });
    return () => { active = false; };
  }, []);

  const messages = {
    checking: "Checking four receipts on Diana…",
    confirmed: "Four receipts confirmed on Diana",
    unavailable: "Diana RPC is unavailable. Explore the recorded transactions below.",
    mismatch: "The live receipts did not match the recorded case. Inspect the transactions below.",
  };

  return (
    <section id="missed-deadline" className="case-proof" aria-labelledby="deadline-title" tabIndex={-1}>
      <div className="case-proof-header">
        <div>
          <p className="eyebrow">Completed Diana testnet case</p>
          <h2 id="deadline-title">The program missed the deadline. The researcher got paid.</h2>
        </div>
        <p className="case-verification" role="status" data-verification={verification}>{messages[verification]}</p>
      </div>
      <ol className="case-timeline">
        {milestones.map(({ title, detail, receipt }, index) => (
          <li key={title}>
            <h3>{title}</h3>
            <p>{detail}</p>
            <a href={receipts[index].explorer} target="_blank" rel="noreferrer">{receipt} ↗</a>
          </li>
        ))}
      </ol>
      <p className="case-scope">This case used a synthetic report and test tokens. Programs opt in and fund the pool.
        An escalation requires a transaction, and two of the three auditors still have to approve the payout.</p>
      <div className="case-actions">
        <a className="primary-button" href="/demo-v5.mp4">Watch the V5 demo</a>
        <button id="start-quorum-demo" className="secondary-button" type="button" disabled={demoBusy} onClick={onTrySigning}>
          {demoBusy ? "Sealing demo report…" : "Try signing in your browser"}
        </button>
      </div>
      {demoError && <div className="error-callout" role="alert">{demoError}</div>}
    </section>
  );
}
