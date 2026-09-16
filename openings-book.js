/* ========================================================================
   OPENING BOOK — TRIE BUILDER & LOOKUP
   ========================================================================
   The actual opening data (OPENING_BOOK, ~12,300 named ECO A-E lines
   sourced from lichess-org/chess-openings + SCID, via eco.json) lives
   in openings-data.js, which must be loaded before this file.

   This file turns that flat list into a lookup trie once at startup
   and exposes:
     isBookMove(sanMoves, uptoIndexInclusive) -> boolean
     getOpeningAt(sanMoves, uptoIndexInclusive) -> {eco, name} | null

   Each entry is one named line: the ECO code, the opening/variation
   name, and the move sequence that reaches it (SAN, space-separated,
   no move numbers — matching the format game.history() returns).

   Lookups are a simple walk down the tree (one step per ply played)
   rather than scanning the array. Longer/more specific lines naturally
   sit deeper than shorter ones at the exact ply where they diverge,
   and any position that is a *prefix* of a known line (even if not
   itself individually named) is still recognized as "in book" — the
   trie doesn't require an exact line match, just that the position
   lies on a still-known path.
   ======================================================================== */

/* ------------------------------------------------------------------------
   TRIE CONSTRUCTION

   Turns the flat OPENING_BOOK list above into a tree keyed by move, so
   a lookup is a walk of length "number of moves played" rather than a
   scan over every catalogued line. Each node optionally carries the
   {eco, name} of the most specific opening known to end exactly there.
   ------------------------------------------------------------------------ */

function buildOpeningTrie(entries) {

    const root = { children: {}, info: null };

    entries.forEach(function (entry) {

        const moves = entry.moves.split(" ");

        let node = root;

        moves.forEach(function (san) {

            if (!node.children[san]) {
                node.children[san] = { children: {}, info: null };
            }

            node = node.children[san];

        });

        // A later, more specific entry that reaches the same exact
        // node (shouldn't normally happen, but just in case) keeps
        // whichever name was defined first — first-write-wins avoids
        // depending on array order for the common case.
        if (!node.info) {
            node.info = { eco: entry.eco, name: entry.name };
        }

    });

    return root;

}

const OPENING_TRIE = buildOpeningTrie(OPENING_BOOK);

/* ------------------------------------------------------------------------
   LOOKUP HELPERS
   ------------------------------------------------------------------------ */

// Walks the trie for the first (uptoIndexInclusive + 1) SAN moves of
// sanMoves. Returns { node, plyReached, lastNamed } where plyReached
// is how many moves were actually still on a known path (may be less
// than requested, once the game leaves the book) and lastNamed is the
// {eco, name} of the deepest *named* node encountered along the way
// (i.e. the most specific opening name known so far), or null if no
// move at all matched a catalogued line.
function walkOpeningTrie(sanMoves, uptoIndexInclusive) {

    let node = OPENING_TRIE;
    let lastNamed = null;
    let plyReached = 0;

    for (let i = 0; i <= uptoIndexInclusive; i++) {

        const san = sanMoves[i];

        if (!node.children[san]) break;

        node = node.children[san];
        plyReached = i + 1;

        if (node.info) {
            lastNamed = node.info;
        }

    }

    return { node: node, plyReached: plyReached, lastNamed: lastNamed };

}

// True if the position after sanMoves[uptoIndexInclusive] still lies
// on a path some catalogued opening line passes through — used to
// classify a move as "Book" during game review. This does not require
// the position to itself be named, only that it's a still-recognized
// continuation (mirrors how chess.com/lichess treat "book" moves).
function isBookMove(sanMoves, uptoIndexInclusive) {

    const result = walkOpeningTrie(sanMoves, uptoIndexInclusive);

    return result.plyReached === uptoIndexInclusive + 1;

}

// Returns the most specific named opening reached by sanMoves up to
// and including uptoIndexInclusive, walking as far into the trie as
// the moves allow. Once the game leaves the book this keeps returning
// the last known name (the same "still labeled by its last known
// opening" behavior other chess apps use), rather than going blank.
// Returns null only if no move at all matched anything in the book.
function getOpeningAt(sanMoves, uptoIndexInclusive) {

    if (uptoIndexInclusive < 0) return null;

    return walkOpeningTrie(sanMoves, uptoIndexInclusive).lastNamed;

}

/* ------------------------------------------------------------------------
   SUPPLEMENTARY LINES

   Even a large sourced database (openings-data.js) only names discrete
   branch points, not literally every legal continuation — so a small
   number of extremely common, heavily-analyzed lines can still be
   missing at the exact branch a game reaches. These are hand-verified
   additions to patch specific known gaps, layered on top of (not
   replacing) the main dataset.
   ------------------------------------------------------------------------ */

[
    { eco: "C54", name: "Italian Game: Möller Attack, Main Line", moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5 exd5 Nxd5 O-O O-O" },
    { eco: "C54", name: "Italian Game: Möller Attack, Alekhine Variation", moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3" },
    { eco: "D35", name: "Queen's Gambit Declined: Exchange Variation, Positional Line", moves: "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 Be7 e3 c6" }
].forEach(function (entry) {

    const moves = entry.moves.split(" ");
    let node = OPENING_TRIE;

    moves.forEach(function (san) {

        if (!node.children[san]) {
            node.children[san] = { children: {}, info: null };
        }

        node = node.children[san];

    });

    node.info = { eco: entry.eco, name: entry.name };

});
