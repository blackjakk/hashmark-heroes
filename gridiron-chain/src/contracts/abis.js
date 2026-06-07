// ─── Contract ABIs (generated from compiled contracts) ────────────────────────
// These are the minimal ABIs needed by the frontend. Run `npm run compile`
// and Hardhat will generate full artifacts in src/contracts/artifacts/.

export const GRID_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function faucet()",
  "function mintReward(address to, uint256 amount)",
  "function lastFaucetTime(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Faucet(address indexed recipient, uint256 amount)",
];

export const TEAM_NFT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function TEAM_PRICE() view returns (uint256)",
  "function TOTAL_TEAMS() view returns (uint256)",
  "function purchaseTeam(uint256 tokenId)",
  "function addToRoster(uint256 teamId, uint256 playerId)",
  "function removeFromRoster(uint256 teamId, uint256 playerId)",
  "function getRoster(uint256 teamId) view returns (uint256[])",
  "function getTeam(uint256 teamId) view returns (tuple(string name, string city, string conference, string division, string primaryColor, string secondaryColor, string mascot))",
  "function availableTeams() view returns (uint256[])",
  "event TeamPurchased(uint256 indexed tokenId, address indexed buyer)",
  "event PlayerRostered(uint256 indexed teamId, uint256 indexed playerId)",
  "event PlayerCut(uint256 indexed teamId, uint256 indexed playerId)",
];

export const PLAYER_NFT_ABI = [
  "function name() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function totalMinted() view returns (uint256)",
  "function getPlayer(uint256 id) view returns (tuple(string name, uint8 position, uint8 age, uint8 overall, uint256 teamId, uint256 contractYears, uint256 salary, tuple(uint8 speed, uint8 strength, uint8 agility, uint8 awareness, uint8 throwing, uint8 catching, uint8 blocking, uint8 passRush, uint8 coverage, uint8 tackle, uint8 kickPower) stats, uint256 season))",
  "function mint(address to, string name, uint8 position, uint8 age, tuple(uint8 speed, uint8 strength, uint8 agility, uint8 awareness, uint8 throwing, uint8 catching, uint8 blocking, uint8 passRush, uint8 coverage, uint8 tackle, uint8 kickPower) stats, uint256 salary, uint256 season) returns (uint256)",
  "function sign(uint256 id, uint256 teamId, uint256 years, uint256 salary)",
  "function release(uint256 id)",
  "function setMinter(address who, bool allowed)",
  "event PlayerMinted(uint256 indexed id, string name, uint8 pos, uint8 overall)",
  "event PlayerSigned(uint256 indexed id, uint256 teamId, uint256 years, uint256 salary)",
];

export const DRAFT_ABI = [
  "function currentSeason() view returns (uint256)",
  "function draftOpen() view returns (bool)",
  "function ROUNDS() view returns (uint256)",
  "function PICK_FEE() view returns (uint256)",
  "function draftOrder(uint256 index) view returns (uint256)",
  "function getProspects() view returns (uint256[])",
  "function getTeamPicks(uint256 season, uint256 teamId) view returns (tuple(uint256 teamId, uint8 round, uint8 slot, uint256 playerId, bool used)[])",
  "function getRoundPicks(uint256 season, uint8 round) view returns (tuple(uint256 teamId, uint8 round, uint8 slot, uint256 playerId, bool used)[])",
  "function prospectTaken(uint256 season, uint256 idx) view returns (bool)",
  "function selectPlayer(uint256 pickIdx, uint256 prospectIdx)",
  "function tradePicks(uint256 teamAId, uint256 pickIdxA, uint256 teamBId, uint256 pickIdxB)",
  "function openDraft(uint256 season, uint256[] prospectIds)",
  "function closeDraft()",
  "function setDraftOrder(uint256[32] order)",
  "event PickMade(uint256 indexed season, uint256 indexed teamId, uint256 indexed playerId, uint8 round, uint8 slot)",
  "event DraftOpened(uint256 indexed season, uint256 prospects)",
  "event DraftClosed(uint256 indexed season)",
];

export const FREE_AGENCY_ABI = [
  "function totalListings() view returns (uint256)",
  "function AUCTION_DURATION() view returns (uint256)",
  "function MIN_INCREMENT() view returns (uint256)",
  "function MARKET_FEE_BPS() view returns (uint256)",
  "function listings(uint256 id) view returns (tuple(uint256 playerId, address seller, uint256 sellerTeamId, uint256 price, uint256 highBid, address highBidder, uint256 deadline, uint8 kind, bool active))",
  "function getListings(uint256 from, uint256 count) view returns (tuple(uint256 playerId, address seller, uint256 sellerTeamId, uint256 price, uint256 highBid, address highBidder, uint256 deadline, uint8 kind, bool active)[])",
  "function pendingReturns(address) view returns (uint256)",
  "function list(uint256 playerId, uint256 teamId, uint256 price, uint8 kind) returns (uint256)",
  "function buyNow(uint256 id, uint256 buyerTeamId)",
  "function placeBid(uint256 id, uint256 amount, uint256 buyerTeamId)",
  "function settleAuction(uint256 id, uint256 buyerTeamId)",
  "function cancel(uint256 id)",
  "function withdraw()",
  "event Listed(uint256 indexed id, uint256 indexed playerId, uint8 kind, uint256 price)",
  "event BidPlaced(uint256 indexed id, address bidder, uint256 amount)",
  "event Sold(uint256 indexed id, uint256 indexed playerId, address buyer, uint256 price)",
  "event Cancelled(uint256 indexed id)",
];

export const LEAGUE_ABI = [
  "function season() view returns (uint256)",
  "function phase() view returns (uint8)",
  "function CHAMPION_PRIZE() view returns (uint256)",
  "function champions(uint256 season) view returns (uint256)",
  "function getRecord(uint256 season, uint256 teamId) view returns (tuple(uint16 wins, uint16 losses, uint16 ties, uint32 pointsFor, uint32 pointsAgainst))",
  "function getAllRecords(uint256 season) view returns (uint256[] teamIds, tuple(uint16 wins, uint16 losses, uint16 ties, uint32 pointsFor, uint32 pointsAgainst)[] recs)",
  "function getSchedule(uint256 season) view returns (tuple(uint256 homeTeamId, uint256 awayTeamId, uint8 week, uint8 homeScore, uint8 awayScore, bool played)[])",
  "function getWeekGames(uint256 season, uint8 week) view returns (tuple(uint256 homeTeamId, uint256 awayTeamId, uint8 week, uint8 homeScore, uint8 awayScore, bool played)[])",
  "function playoffSeeds(uint256 season) view returns (uint256[14])",
  "function startSeason()",
  "function advancePhase()",
  "function recordResult(uint256 gameIdx, uint8 homeScore, uint8 awayScore)",
  "function crownChampion(uint256 teamId)",
  "event SeasonStarted(uint256 indexed season, uint8 phase)",
  "event PhaseAdvanced(uint256 indexed season, uint8 phase)",
  "event GameRecorded(uint256 indexed season, uint8 week, uint256 home, uint256 away, uint8 hs, uint8 as_)",
  "event ChampionCrowned(uint256 indexed season, uint256 indexed teamId, address owner_)",
];

// Phase enum values
export const PHASE = {
  Offseason:     0,
  FreeAgency:    1,
  Draft:         2,
  PreSeason:     3,
  RegularSeason: 4,
  Playoffs:      5,
  GrandFinal:    6,
};

export const PHASE_LABEL = [
  "Offseason", "Free Agency", "Draft", "Pre-Season",
  "Regular Season", "Playoffs", "Grand Final",
];

// Position enum
export const POSITION_LABEL = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
