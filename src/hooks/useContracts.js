import { useMemo } from "react";
import { ethers } from "ethers";
import {
  GRID_TOKEN_ABI, TEAM_NFT_ABI, PLAYER_NFT_ABI,
  DRAFT_ABI, FREE_AGENCY_ABI, LEAGUE_ABI,
} from "../contracts/abis.js";
import ADDRESSES from "../contracts/addresses.json";

export function useContracts(signerOrProvider) {
  return useMemo(() => {
    if (!signerOrProvider) return null;
    const c = (addr, abi) => new ethers.Contract(addr, abi, signerOrProvider);
    return {
      token:   c(ADDRESSES.gridironToken, GRID_TOKEN_ABI),
      team:    c(ADDRESSES.teamNFT,       TEAM_NFT_ABI),
      player:  c(ADDRESSES.playerNFT,     PLAYER_NFT_ABI),
      draft:   c(ADDRESSES.draftSystem,   DRAFT_ABI),
      fa:      c(ADDRESSES.freeAgency,    FREE_AGENCY_ABI),
      league:  c(ADDRESSES.leagueManager, LEAGUE_ABI),
    };
  }, [signerOrProvider]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmt(wei, decimals = 0) {
  const v = parseFloat(ethers.formatEther(wei));
  return v.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export function parseGRID(amount) {
  return ethers.parseEther(String(amount));
}

export async function approveERC20(tokenContract, spender, amount) {
  const current = await tokenContract.allowance(
    await tokenContract.runner.getAddress(),
    spender
  );
  if (current < amount) {
    const tx = await tokenContract.approve(spender, amount);
    await tx.wait();
  }
}

export async function fetchMyTeams(teamContract, address) {
  const bal = await teamContract.balanceOf(address);
  const ids = [];
  // ERC721 doesn't have tokenOfOwnerByIndex without Enumerable — scan 1..32
  for (let i = 1; i <= 32; i++) {
    try {
      const owner = await teamContract.ownerOf(i);
      if (owner.toLowerCase() === address.toLowerCase()) ids.push(i);
    } catch { /* token not yet minted or burned */ }
  }
  return ids;
}

export async function fetchTeamDetails(teamContract, playerContract, teamId) {
  const t = await teamContract.getTeam(teamId);
  const roster = await teamContract.getRoster(teamId);

  const players = await Promise.all(
    roster.map(async (pid) => {
      try {
        const p = await playerContract.getPlayer(pid);
        return { id: Number(pid), ...p };
      } catch { return null; }
    })
  );

  return {
    id: Number(teamId),
    name: t.name, city: t.city,
    conference: t.conference, division: t.division,
    primaryColor: t.primaryColor, secondaryColor: t.secondaryColor,
    mascot: t.mascot,
    roster: players.filter(Boolean),
  };
}
