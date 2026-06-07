import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

const MEGAETH_CHAIN = {
  chainId: "0x18C6",  // 6342
  chainName: "MegaETH Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://carrot.megaeth.com"],
  blockExplorerUrls: ["https://www.megaexplorer.xyz"],
};

export function useWallet() {
  const [address, setAddress]   = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner]     = useState(null);
  const [chainId, setChainId]   = useState(null);
  const [balance, setBalance]   = useState("0");
  const [error, setError]       = useState(null);
  const [connecting, setConnecting] = useState(false);

  const isCorrectChain = chainId === 6342;

  const updateBalance = useCallback(async (prov, addr) => {
    try {
      const bal = await prov.getBalance(addr);
      setBalance(ethers.formatEther(bal));
    } catch { /* ignore */ }
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("No wallet detected. Please install MetaMask.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const prov = new ethers.BrowserProvider(window.ethereum);
      await prov.send("eth_requestAccounts", []);
      const sign = await prov.getSigner();
      const addr = await sign.getAddress();
      const net  = await prov.getNetwork();

      setProvider(prov);
      setSigner(sign);
      setAddress(addr);
      setChainId(Number(net.chainId));
      await updateBalance(prov, addr);
    } catch (e) {
      setError(e.message || "Connection failed");
    } finally {
      setConnecting(false);
    }
  }, [updateBalance]);

  const switchToMegaETH = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MEGAETH_CHAIN.chainId }],
      });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [MEGAETH_CHAIN],
        });
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null); setProvider(null); setSigner(null);
    setChainId(null);  setBalance("0");
  }, []);

  // Listen for account / chain changes
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccounts = (accounts) => {
      if (!accounts.length) disconnect();
      else setAddress(accounts[0]);
    };
    const onChain = (id) => setChainId(parseInt(id, 16));
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged",    onChain);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccounts);
      window.ethereum.removeListener("chainChanged",    onChain);
    };
  }, [disconnect]);

  // Auto-refresh balance
  useEffect(() => {
    if (!provider || !address) return;
    updateBalance(provider, address);
    const id = setInterval(() => updateBalance(provider, address), 12000);
    return () => clearInterval(id);
  }, [provider, address, updateBalance]);

  const shortAddr = address ? `${address.slice(0,6)}…${address.slice(-4)}` : null;

  return {
    address, shortAddr, provider, signer, chainId,
    isCorrectChain, balance, error, connecting,
    connect, disconnect, switchToMegaETH,
  };
}
