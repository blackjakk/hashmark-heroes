// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PlayerNFT.sol";
import "./TeamNFT.sol";
import "./GridironToken.sol";

/// @notice Two-mode marketplace: fixed-price listing and ascending auction
contract FreeAgency is Ownable {
    PlayerNFT     public immutable playerNFT;
    TeamNFT       public immutable teamNFT;
    GridironToken public immutable grid;

    uint256 public constant AUCTION_DURATION  = 48 hours;
    uint256 public constant AUCTION_EXTENSION = 15 minutes;
    uint256 public constant MIN_INCREMENT     = 10 * 10 ** 18;  // 10 GRID
    uint256 public constant MARKET_FEE_BPS    = 250;            // 2.5 %

    enum ListingKind { FixedPrice, Auction }

    struct Listing {
        uint256     playerId;
        address     seller;
        uint256     sellerTeamId;
        uint256     price;       // fixed price OR auction reserve
        uint256     highBid;
        address     highBidder;
        uint256     deadline;    // auction only
        ListingKind kind;
        bool        active;
    }

    Listing[] public listings;

    // pending returns for outbid buyers
    mapping(address => uint256) public pendingReturns;

    event Listed(uint256 indexed id, uint256 indexed playerId, ListingKind kind, uint256 price);
    event BidPlaced(uint256 indexed id, address bidder, uint256 amount);
    event Sold(uint256 indexed id, uint256 indexed playerId, address buyer, uint256 price);
    event Cancelled(uint256 indexed id);

    constructor(address _player, address _team, address _token) Ownable(msg.sender) {
        playerNFT = PlayerNFT(_player);
        teamNFT   = TeamNFT(_team);
        grid      = GridironToken(_token);
    }

    // ─── Listing ──────────────────────────────────────────────────────────────

    function list(
        uint256     playerId,
        uint256     teamId,
        uint256     price,
        ListingKind kind
    ) external returns (uint256 listingId) {
        require(playerNFT.ownerOf(playerId) == msg.sender, "FA: not player owner");
        require(teamNFT.ownerOf(teamId)     == msg.sender, "FA: not team owner");
        require(price > 0, "FA: zero price");

        playerNFT.transferFrom(msg.sender, address(this), playerId);
        playerNFT.release(playerId);
        teamNFT.removeFromRoster(teamId, playerId);

        listingId = listings.length;
        listings.push(Listing({
            playerId:     playerId,
            seller:       msg.sender,
            sellerTeamId: teamId,
            price:        price,
            highBid:      0,
            highBidder:   address(0),
            deadline:     kind == ListingKind.Auction ? block.timestamp + AUCTION_DURATION : 0,
            kind:         kind,
            active:       true
        }));
        emit Listed(listingId, playerId, kind, price);
    }

    // ─── Fixed-price buy ──────────────────────────────────────────────────────

    function buyNow(uint256 id, uint256 buyerTeamId) external {
        Listing storage L = listings[id];
        require(L.active && L.kind == ListingKind.FixedPrice, "FA: not fixed listing");
        require(teamNFT.ownerOf(buyerTeamId) == msg.sender, "FA: not team owner");

        uint256 fee  = (L.price * MARKET_FEE_BPS) / 10_000;
        grid.transferFrom(msg.sender, L.seller,  L.price - fee);
        grid.transferFrom(msg.sender, owner(),   fee);

        L.active = false;
        _deliverPlayer(L.playerId, msg.sender, buyerTeamId);
        emit Sold(id, L.playerId, msg.sender, L.price);
    }

    // ─── Auction ──────────────────────────────────────────────────────────────

    function placeBid(uint256 id, uint256 amount, uint256 buyerTeamId) external {
        Listing storage L = listings[id];
        require(L.active && L.kind == ListingKind.Auction, "FA: not auction");
        require(block.timestamp < L.deadline, "FA: auction ended");
        require(teamNFT.ownerOf(buyerTeamId) == msg.sender, "FA: not team owner");
        require(
            amount >= L.price &&
            amount >= L.highBid + MIN_INCREMENT,
            "FA: bid too low"
        );

        if (L.highBidder != address(0)) {
            pendingReturns[L.highBidder] += L.highBid;
        }
        grid.transferFrom(msg.sender, address(this), amount);
        L.highBid    = amount;
        L.highBidder = msg.sender;

        // Extend deadline if bid arrives in last 15 min
        if (L.deadline - block.timestamp < AUCTION_EXTENSION) {
            L.deadline += AUCTION_EXTENSION;
        }
        emit BidPlaced(id, msg.sender, amount);
    }

    function settleAuction(uint256 id, uint256 buyerTeamId) external {
        Listing storage L = listings[id];
        require(L.active && L.kind == ListingKind.Auction, "FA: not auction");
        require(block.timestamp >= L.deadline,   "FA: still running");
        require(L.highBidder == msg.sender,      "FA: not winner");
        require(teamNFT.ownerOf(buyerTeamId) == msg.sender, "FA: not team owner");

        L.active = false;
        uint256 fee = (L.highBid * MARKET_FEE_BPS) / 10_000;
        grid.transfer(L.seller, L.highBid - fee);
        grid.transfer(owner(),  fee);

        _deliverPlayer(L.playerId, msg.sender, buyerTeamId);
        emit Sold(id, L.playerId, msg.sender, L.highBid);
    }

    // ─── Cancel (no bids placed) ──────────────────────────────────────────────

    function cancel(uint256 id) external {
        Listing storage L = listings[id];
        require(L.active, "FA: not active");
        require(L.seller == msg.sender || msg.sender == owner(), "FA: unauthorized");
        require(L.highBidder == address(0), "FA: has bids");

        L.active = false;
        playerNFT.transferFrom(address(this), L.seller, L.playerId);
        emit Cancelled(id);
    }

    // ─── Withdraw overbid returns ─────────────────────────────────────────────

    function withdraw() external {
        uint256 amt = pendingReturns[msg.sender];
        require(amt > 0, "FA: nothing to withdraw");
        pendingReturns[msg.sender] = 0;
        grid.transfer(msg.sender, amt);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getListings(uint256 from, uint256 count) external view returns (Listing[] memory out) {
        uint256 end = from + count > listings.length ? listings.length : from + count;
        out = new Listing[](end - from);
        for (uint256 i = from; i < end; i++) out[i - from] = listings[i];
    }

    function totalListings() external view returns (uint256) {
        return listings.length;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _deliverPlayer(uint256 pid, address to, uint256 teamId) internal {
        playerNFT.transferFrom(address(this), to, pid);
        playerNFT.sign(pid, teamId, 2, playerNFT.getPlayer(pid).salary);
        teamNFT.addToRoster(teamId, pid);
    }
}
