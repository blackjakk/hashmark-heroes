import React, { useState } from "react";
import { ethers } from "ethers";

export default function WalletConnect({ wallet, contracts }) {
  const { address, shortAddr, balance, isCorrectChain, chainId,
          connecting, error, connect, disconnect, switchToMegaETH } = wallet;
  const [gridBal, setGridBal]   = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState("");

  React.useEffect(() => {
    if (!contracts || !address) { setGridBal(null); return; }
    contracts.token.balanceOf(address)
      .then(b => setGridBal(parseFloat(ethers.formatEther(b)).toLocaleString("en-US", { maximumFractionDigits: 0 })))
      .catch(() => {});
  }, [contracts, address]);

  const claimFaucet = async () => {
    if (!contracts) return;
    setClaiming(true); setClaimMsg("");
    try {
      const tx = await contracts.token.faucet();
      await tx.wait();
      setClaimMsg("50 000 GRID claimed!");
      const b = await contracts.token.balanceOf(address);
      setGridBal(parseFloat(ethers.formatEther(b)).toLocaleString("en-US", { maximumFractionDigits: 0 }));
    } catch (e) {
      setClaimMsg(e.reason || e.message || "Claim failed");
    } finally { setClaiming(false); }
  };

  if (!address) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
        {error && <span style={{ color: "#e57373", fontSize: ".75rem" }}>{error}</span>}
        <button className="btn btn-gold" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect Wallet"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: ".75rem", fontSize: ".8rem" }}>
      {!isCorrectChain && (
        <button className="btn btn-danger btn-sm" onClick={switchToMegaETH}>
          Switch to MegaETH
        </button>
      )}
      {gridBal !== null && (
        <span className="text-gold" style={{ fontWeight: 700 }}>
          {gridBal} GRID
        </span>
      )}
      {claimMsg && (
        <span style={{ color: claimMsg.includes("claimed") ? "#4caf7a" : "#e57373", fontSize: ".75rem" }}>
          {claimMsg}
        </span>
      )}
      <button className="btn btn-outline btn-sm" onClick={claimFaucet} disabled={claiming || !isCorrectChain} title="Claim 50 000 GRID from faucet (24h cooldown)">
        {claiming ? "Claiming…" : "Faucet"}
      </button>
      <div style={{ background: "var(--bg3)", padding: ".3rem .7rem", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
        <span style={{ color: "var(--gray)" }}>
          {isCorrectChain
            ? <span style={{ color: "#4caf7a" }}>● </span>
            : <span style={{ color: "#e57373" }}>● </span>}
          {shortAddr}
        </span>
      </div>
      <button className="btn btn-outline btn-sm" onClick={disconnect}>Disconnect</button>
    </div>
  );
}
