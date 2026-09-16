
        /* ========================================
           GAME VARIABLES
        ======================================== */

        let game = new Chess();
        let board;

        let selected = null;
        let pendingMove = null;
        let currentMode = "";
        let moveHistory = [];
        let currentMoveIndex = 0;
        let finishedGamePGN = "";
        let gameResult = "";
        let reviewBoard;
let reviewPositionGame = new Chess();
let reviewMoves = [];
let reviewMoveIndex = 0;

        /* ========================================
           CHESS CLOCK STATE
           ----------------------------------------
           Only relevant to two-player mode. Local/
           casual semantics, not tournament-strict —
           see beginTurnClock/undoMove for what that
           means for Undo specifically.
        ======================================== */

        // What the *next* resetGame() should apply — set by the time
        // control picker, reused as-is by "New Game" so it doesn't
        // silently drop back to no clock mid-session.
        let clockConfigEnabled = false;
        let clockConfigBaseMinutes = 0;
        let clockConfigIncrementSeconds = 0;

        // Live clock state for the game actually in progress.
        let clockEnabled = false;
        let clockIncrementMs = 0;
        let whiteRemainingMs = 0;
        let blackRemainingMs = 0;
        let clockActiveColor = null; // 'w' | 'b' | null (not running)
        let clockTurnStartTs = null;
        let clockRemainingAtTurnStart = 0;
        let clockIntervalId = null;

        // Assumed player rating for move-classification purposes only
        // (see winPercentWhite / ratingLeniency) — adjustable from
        // Settings, remembered locally. Chess.com's real rating-
        // adjustment curve isn't published; this is a good-faith
        // approximation in the same spirit, not a reverse-engineered
        // replica of their exact numbers.
        let playerRating = parseInt(localStorage.getItem("playerRating"), 10) || 1200;

        /* ========================================
           MOVE CLASSIFICATION LOOKUP
        ======================================== */

        const MOVE_CLASS = {
            brilliant:  { label: "Brilliant",  icon: "!!",           color: "#00b0a8" },
            great:      { label: "Great",      icon: "!",            color: "#4c8cb2" },
            book:       { label: "Book",       icon: "\uD83D\uDCD6", color: "#a68264" },
            best:       { label: "Best",       icon: "\u2605",       color: "#8cbe31" },
            excellent:  { label: "Excellent",  icon: "\uD83D\uDC4D", color: "#8bba37" },
            good:       { label: "Good",       icon: "\u2713",       color: "#95b18d" },
            inaccuracy: { label: "Inaccuracy", icon: "?!",           color: "#fbbe12" },
            mistake:    { label: "Mistake",    icon: "?",            color: "#f38a02" },
            miss:       { label: "Miss",       icon: "\u2715",       color: "#fb614a" },
            blunder:    { label: "Blunder",    icon: "??",           color: "#d91c25" }
        };

        // Crisp flat-vector versions of the "pictorial" badges (star,
        // thumbs-up, check, book, x) so they render identically on
        // every device instead of relying on the OS's own emoji/glyph
        // set. The "!!" / "!" / "?!" / "?" / "??" badges stay as plain
        // bold text, same as the reference design.
        const MOVE_CLASS_SVG = {
            best: '<svg viewBox="0 0 24 24" width="62%" height="62%" fill="#fff"><path d="M12 2.5l2.9 6.26 6.85.87-5.06 4.76 1.36 6.86L12 17.9l-6.05 3.35 1.36-6.86-5.06-4.76 6.85-.87z"/></svg>',
            excellent: '<svg viewBox="0 0 24 24" width="60%" height="60%" fill="#fff"><path d="M1 22h4V10H1v12zM23 11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 2 7.59 8.59C7.22 8.95 7 9.45 7 10v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>',
            good: '<svg viewBox="0 0 24 24" width="66%" height="66%" fill="#fff"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
            book: '<svg viewBox="0 0 24 24" width="62%" height="62%" fill="#fff"><path d="M12 21.3c-1.42-1-3.2-1.55-5-1.55-1.13 0-2.4.2-3.4.7-.6.3-1.1-.2-1.1-.8V5.75c0-.32.2-.6.45-.72C3.97 4.48 5.4 4.25 7 4.25c1.8 0 3.58.55 5 1.55V21.3zm0 0c1.42-1 3.2-1.55 5-1.55 1.13 0 2.4.2 3.4.7.6.3 1.1-.2 1.1-.8V5.75c0-.32-.2-.6-.45-.72-1.08-.55-2.51-.78-4.05-.78-1.8 0-3.58.55-5 1.55V21.3z"/></svg>',
            miss: '<svg viewBox="0 0 24 24" width="58%" height="58%" fill="#fff"><path d="M18.3 5.71L12 12.01 5.7 5.71 4.29 7.12l6.3 6.3-6.3 6.29 1.41 1.42 6.3-6.3 6.3 6.3 1.41-1.42-6.3-6.29 6.3-6.3z"/></svg>'
        };

        // Returns the HTML to drop into a badge element (an <svg> for
        // the five pictorial classes, or the plain "!!"/"!"/etc. text
        // for the rest) for a given classification key.
        function getMoveClassIconHTML(key) {

            const info = MOVE_CLASS[key];

            if (!info) return "";

            return MOVE_CLASS_SVG[key] || info.icon;

        }

        // Rough material values, used only to guess whether a "best"
        // move was also a sacrifice (for the Brilliant label).
        const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

        // Opening ("Book") detection is provided by openings-book.js,
        // which must be loaded before this file. It builds a lookup
        // trie from a large ECO-coded set of named lines (OPENING_BOOK)
        // and exposes:
        //   isBookMove(sanMoves, uptoIndexInclusive) -> boolean
        //   getOpeningAt(sanMoves, uptoIndexInclusive) -> {eco, name} | null

        // Analysis results are cached by PGN string so re-opening the
        // same finished game does not re-run Stockfish from scratch.
        let analysisCache = {};
        let currentAnalysis = null;

        /* ========================================
           GAME MODES
        ======================================== */

        // Shows the time control picker instead of jumping straight
        // into a two-player game, so a time control can be chosen
        // fresh each time "Play Chess" is opened from the home screen.
        function openTimeControlPicker() {

            document.getElementById(
                "home-screen"
            ).style.display = "none";

            document.getElementById(
                "timecontrol-screen"
            ).style.display = "flex";

        }

        function closeTimeControlPicker() {

            document.getElementById(
                "timecontrol-screen"
            ).style.display = "none";

            document.getElementById(
                "home-screen"
            ).style.display = "flex";

        }

        // baseMinutes/incrementSeconds come from the time control
        // picker's buttons. Pass (null, null) for "No Clock". Called
        // with no arguments at all, it's reused internally by things
        // like the more-menu's "New Game" (via resetGame(), which
        // reapplies whatever clockConfig was last chosen) rather than
        // going through this function again.
        function startTwoPlayers(baseMinutes, incrementSeconds) {

    currentMode = "twoPlayers";

    document.getElementById(
        "home-screen"
    ).style.display = "none";

    document.getElementById(
        "timecontrol-screen"
    ).style.display = "none";

    document.getElementById(
        "game-screen"
    ).style.display = "block";

    document.getElementById(
        "two-player-bar"
    ).style.display = "flex";

    document.getElementById(
        "analysis-bar"
    ).style.display = "none";
    document.getElementById(
    "analysis-controls"
).style.display = "none";

    if (baseMinutes && incrementSeconds !== undefined) {

        clockConfigEnabled = true;
        clockConfigBaseMinutes = baseMinutes;
        clockConfigIncrementSeconds = incrementSeconds;

    } else if (arguments.length > 0) {

        // Explicit "No Clock" selection (called as (null, null)).
        clockConfigEnabled = false;

    }
    // Called with zero arguments: leave clockConfig* untouched, so
    // whatever was last chosen carries over.

    resetGame();
}

        function openAnalysis() {

    currentMode = "analysis";

    document.getElementById(
        "home-screen"
    ).style.display = "none";

    document.getElementById(
        "game-screen"
    ).style.display = "none";

    document.getElementById(
        "pgn-screen"
    ).style.display = "flex";

}

        function goHome() {

    stopClockInterval();

    document.getElementById(
        "game-screen"
    ).style.display = "none";

    document.getElementById(
        "pgn-screen"
    ).style.display = "none";

    document.getElementById(
        "home-screen"
    ).style.display = "flex";

    document.getElementById(
        "analysis-bar"
    ).style.display = "none";

    document.getElementById(
        "two-player-bar"
    ).style.display = "none";

}

        /* ========================================
           PROMOTION HELPER
        ======================================== */

        

        /* ========================================
           BOARD SQUARE ATTRIBUTES
           ----------------------------------------
           chessboard.js already stamps a correct,
           orientation-aware data-square attribute on
           every square div itself (see buildBoardHTML
           in chessboard-1.0.0.js) — including after
           board.orientation('black'), board.position(),
           and board.move(). A previous version of this
           file re-stamped those attributes on top with
           a hardcoded white-on-bottom (a8..h1) ordering,
           which happened to match chessboard.js's own
           default orientation and so looked harmless —
           but after flipping to black orientation, the
           real DOM order reverses (h1..a8) while this
           hardcoded pass kept relabeling it as if it
           hadn't, silently swapping every square with
           its 180°-opposite. That meant clicking a piece
           after a flip could select the wrong color's
           piece entirely. Removed — there is nothing to
           fix here; use the library's own attributes.
        ======================================== */

        /* ========================================
           HIGHLIGHT SELECTED PIECE
        ======================================== */

        function highlightSelected(square) {

            let el = document.querySelector(
                '[data-square="' + square + '"]'
            );

            if (el) {
                el.classList.add('selected-piece');
            }

        }

        /* ========================================
           INITIALIZE BOARD
        ======================================== */

        function initBoard() {

            board = Chessboard('board', {

                position: 'start',

                pieceTheme: function (piece) {
                    return piece + ".png";
                },

                draggable: false

            });
            reviewBoard = Chessboard('review-board', {

    position: 'start',

    pieceTheme: function (piece) {
        return piece + ".png";
    },

    draggable: false

});

            setTimeout(() => {

                enableTap();

            }, 100);

            updateState();

        }

        /* ========================================
           ENABLE TOUCH / TAP CONTROLS
        ======================================== */

        function enableTap() {

            document.getElementById("board")
                .addEventListener("pointerdown", function (e) {

                    let squareEl = e.target.closest(".square-55d63");

                    if (!squareEl) return;

                    let square = squareEl.getAttribute("data-square");

                    if (!square) return;

                    handle(square);

                });

        }

        /* ========================================
           PROMOTION POPUP
        ======================================== */

        function showPromotionPopup(color) {

            // color is 'w' or 'b' — the side that is promoting.
            // Swap the popup images so black promotions show black
            // pieces instead of always showing white ones.
            const pieces = { q: 'Q', r: 'R', b: 'B', n: 'N' };

            Object.keys(pieces).forEach(function (key) {

                const img = document.getElementById('promo-' + key);

                if (img) {
                    img.src = color + pieces[key] + '.png';
                }

            });

            document.getElementById(
                'promotion-popup'
            ).style.display = 'flex';

        }

        function hidePromotionPopup() {

            document.getElementById(
                'promotion-popup'
            ).style.display = 'none';

        }

        function selectPromotion(piece) {

            hidePromotionPopup();

            game.move({

                from: pendingMove.from,
                to: pendingMove.to,
                promotion: piece

            });

            pendingMove = null;
            selected = null;

            clearUI();

            board.position(game.fen());

            onMoveMade();

            updateState();

        }

        /* ========================================
           HANDLE BOARD TAP / MOVE LOGIC
        ======================================== */

        function handle(square) {

            const piece = game.get(square);

            if (!selected) {

                if (!piece) return;

                if (piece.color !== game.turn()) return;

                selected = square;

                clearUI();

                highlightSelected(square);

                showDots(
                    game.moves({
                        square: square,
                        verbose: true
                    })
                );

                return;

            }

            if (square === selected) {

                selected = null;

                clearUI();

                return;

            }

            if (piece && piece.color === game.turn()) {

                selected = square;

                clearUI();

                highlightSelected(square);

                showDots(
                    game.moves({
                        square: square,
                        verbose: true
                    })
                );

                return;

            }

            const legalMove = game.moves({
                square: selected,
                verbose: true
            }).find(m => m.to === square);

            if (!legalMove) {

                clearUI();
                selected = null;

                return;

            }

            if (legalMove.promotion) {

                pendingMove = {
                    from: selected,
                    to: square
                };

                // Use the color of the piece being promoted (not
                // game.turn(), which is the same thing here but this
                // is clearer and stays correct even if this code is
                // ever called after the move has already been made).
                showPromotionPopup(legalMove.color);

                return;

            }

            let move = game.move({

                from: selected,
                to: square,
                promotion: 'q'

            });

            if (!move) {

                clearUI();
                selected = null;

                return;

            }

            selected = null;

            clearUI();

            if (
                move.flags.includes('k') ||
                move.flags.includes('q') ||
                move.flags.includes('e') ||
                move.promotion
            ) {

                board.position(game.fen());

            } else {

                board.move(move.from + '-' + move.to);

            }

            highlightLastMove(move);

            onMoveMade();

            updateState();

        }

        /* ========================================
           SHOW LEGAL MOVE DOTS
        ======================================== */

        function showDots(moves) {

            moves.forEach(m => {

                let el = document.querySelector(
                    '[data-square="' + m.to + '"]'
                );

                if (!el) return;

                if (m.captured) {

                    let ring = document.createElement("div");

                    ring.className = "capture-ring";

                    el.appendChild(ring);

                } else {

                    let dot = document.createElement("div");

                    dot.className = "dot";

                    el.appendChild(dot);

                }

            });

        }

        /* ========================================
           CLEAR ALL BOARD EFFECTS
        ======================================== */

        function clearUI() {

            document.querySelectorAll(
                ".dot, .capture-ring"
            ).forEach(el => el.remove());

            document.querySelectorAll(".check-square")
                .forEach(el =>
                    el.classList.remove("check-square")
                );

            document.querySelectorAll(".selected-piece")
                .forEach(el =>
                    el.classList.remove("selected-piece")
                );

        }

        /* ========================================
           HIGHLIGHT LAST MOVE
        ======================================== */

        function highlightLastMove(move) {

            document.querySelectorAll('.last-move')
                .forEach(el =>
                    el.classList.remove('last-move')
                );

            let fromEl = document.querySelector(
                '[data-square="' + move.from + '"]'
            );

            let toEl = document.querySelector(
                '[data-square="' + move.to + '"]'
            );

            if (fromEl) {
                fromEl.classList.add('last-move');
            }

            if (toEl) {
                toEl.classList.add('last-move');
            }

        }

        /* ========================================
           GAME STATE CHECKS
        ======================================== */

        function updateState() {

    document.querySelectorAll(".check-square")
        .forEach(el =>
            el.classList.remove("check-square")
        );

    if (game.in_checkmate()) {

        const winner =
            game.turn() === "w"
                ? "Black"
                : "White";

        showGameResult(
    winner + " Wins",
    winner + " wins by checkmate.",
    winner
);

        return;
    }

    if (game.in_draw()) {

        showGameResult(
    "Draw",
    "The game ended in a draw.",
    "draw"
);

        return;
    }

    if (game.in_check()) {

        highlightKing();

    }

    updateOpeningDisplay();

}

        /* ========================================
           OPENING NAME DISPLAY
        ======================================== */

        // Shows the current position's opening (from openings-book.js)
        // above the board, the way chess.com/lichess label a live
        // game. Once the game leaves known theory this keeps showing
        // the last recognized opening rather than going blank.
        function updateOpeningDisplay() {

            const el = document.getElementById("opening-name");

            if (!el) return;

            const sanMoves = game.history();

            if (sanMoves.length === 0) {

                el.textContent = "";
                el.style.display = "none";

                return;

            }

            const info = getOpeningAt(sanMoves, sanMoves.length - 1);

            if (!info) {

                el.textContent = "";
                el.style.display = "none";

                return;

            }

            el.textContent = info.eco + " \u00B7 " + info.name;
            el.style.display = "block";

        }

        /* ========================================
           CHESS CLOCK
           ----------------------------------------
           Only turned on in two-player mode, and only
           when a time control was picked (see
           openTimeControlPicker / startTwoPlayers).

           Undo semantics are intentionally simple: it
           resumes the clock for whoever's turn it now
           is, using their current stored remaining time.
           It does not attempt to reconstruct exactly how
           much time had elapsed before the undone move —
           this is a casual local app, not a tournament
           clock, and that reconstruction isn't worth the
           complexity it'd add.
        ======================================== */

        function startClock(baseMinutes, incrementSeconds) {

            clockEnabled = true;
            clockIncrementMs = incrementSeconds * 1000;

            whiteRemainingMs = baseMinutes * 60000;
            blackRemainingMs = baseMinutes * 60000;

            beginTurnClock("w");

        }

        function disableClock() {

            clockEnabled = false;

            stopClockInterval();

            renderClocks();

        }

        function stopClockInterval() {

            if (clockIntervalId !== null) {

                clearInterval(clockIntervalId);

                clockIntervalId = null;

            }

            clockActiveColor = null;

        }

        function beginTurnClock(color) {

            if (!clockEnabled) return;

            if (clockIntervalId !== null) {

                clearInterval(clockIntervalId);

            }

            clockActiveColor = color;
            clockTurnStartTs = Date.now();

            clockRemainingAtTurnStart =
                color === "w" ? whiteRemainingMs : blackRemainingMs;

            clockIntervalId = setInterval(tickClock, 200);

            renderClocks();

        }

        function tickClock() {

            if (!clockEnabled || !clockActiveColor) return;

            const elapsed = Date.now() - clockTurnStartTs;

            let remaining = clockRemainingAtTurnStart - elapsed;

            if (remaining < 0) remaining = 0;

            if (clockActiveColor === "w") {
                whiteRemainingMs = remaining;
            } else {
                blackRemainingMs = remaining;
            }

            renderClocks();

            if (remaining <= 0) {

                handleFlagFall(clockActiveColor);

            }

        }

        // Called right after any move actually completes (regular
        // move or promotion) — adds the increment to whoever just
        // moved and starts the other side's clock. Works out the
        // mover's color from the turn having already flipped, rather
        // than needing the caller to pass it in.
        function onMoveMade() {

            if (!clockEnabled) return;

            const moverColor = game.turn() === "w" ? "b" : "w";

            const elapsed = Date.now() - clockTurnStartTs;

            let remaining = clockRemainingAtTurnStart - elapsed;

            if (remaining < 0) remaining = 0;

            remaining += clockIncrementMs;

            if (moverColor === "w") {
                whiteRemainingMs = remaining;
            } else {
                blackRemainingMs = remaining;
            }

            beginTurnClock(game.turn());

        }

        function handleFlagFall(color) {

            stopClockInterval();

            const flaggedName = color === "w" ? "White" : "Black";
            const winnerName = color === "w" ? "Black" : "White";

            // Standard chess rule: running out of time is only a loss
            // if the opponent could actually still deliver checkmate.
            // game.insufficient_material() covers the common cases
            // (K v K, K+B v K, K+N v K) — a reasonable approximation
            // for a casual local app rather than a full per-side
            // mating-material search.
            if (game.insufficient_material()) {

                showGameResult(
                    "Draw",
                    flaggedName + " ran out of time, but there's " +
                        "insufficient material for a win.",
                    "draw"
                );

                return;

            }

            showGameResult(
                winnerName + " Wins",
                flaggedName + " ran out of time.",
                winnerName
            );

        }

        function formatClockTime(ms) {

            if (ms < 0) ms = 0;

            // Under 10 seconds, show tenths as a clearer low-time cue
            // (matches chess.com/lichess's own low-time display).
            if (ms < 10000) {

                const wholeSeconds = Math.floor(ms / 1000);
                const tenths = Math.floor((ms % 1000) / 100);

                return wholeSeconds + "." + tenths;

            }

            const totalSeconds = Math.ceil(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;

            return minutes + ":" + String(seconds).padStart(2, "0");

        }

        function renderClocks() {

            const topEl = document.getElementById("clock-top");
            const bottomEl = document.getElementById("clock-bottom");

            if (!topEl || !bottomEl) return;

            if (!clockEnabled) {

                topEl.style.display = "none";
                bottomEl.style.display = "none";

                return;

            }

            topEl.style.display = "inline-block";
            bottomEl.style.display = "inline-block";

            // The live #board is always white-at-bottom unless flipped
            // (flipBoard() also calls this so the swap is immediate).
            const bottomColor =
                board.orientation() === "white" ? "w" : "b";

            const topColor = bottomColor === "w" ? "b" : "w";

            const bottomMs =
                bottomColor === "w" ? whiteRemainingMs : blackRemainingMs;

            const topMs =
                topColor === "w" ? whiteRemainingMs : blackRemainingMs;

            bottomEl.textContent = formatClockTime(bottomMs);
            topEl.textContent = formatClockTime(topMs);

            bottomEl.classList.toggle(
                "clock-active",
                clockActiveColor === bottomColor
            );

            topEl.classList.toggle(
                "clock-active",
                clockActiveColor === topColor
            );

            bottomEl.classList.toggle(
                "clock-low",
                bottomMs > 0 && bottomMs < 30000
            );

            topEl.classList.toggle(
                "clock-low",
                topMs > 0 && topMs < 30000
            );

        }

        /* ========================================
           HIGHLIGHT KING IN CHECK
        ======================================== */

        function highlightKing() {

            let b = game.board();

            for (let r = 0; r < 8; r++) {

                for (let c = 0; c < 8; c++) {

                    let p = b[r][c];

                    if (
                        p &&
                        p.type === "k" &&
                        p.color === game.turn()
                    ) {

                        let sq =
                            String.fromCharCode(97 + c) + (8 - r);

                        let el = document.querySelector(
                            '[data-square="' + sq + '"]'
                        );

                        if (el) {
                            el.classList.add("check-square");
                        }

                    }

                }

            }

        }
    /* ========================================
   GAME RESULT
======================================== */

function showGameResult(title, message, result) {

    stopClockInterval();

    finishedGamePGN = game.pgn();

    gameResult = result;

    document.getElementById(
        "game-result-title"
    ).textContent = title;

    document.getElementById(
        "game-result-message"
    ).textContent = message;

    document.getElementById(
        "game-result-screen"
    ).style.display = "flex";

}

function newGameFromResult() {

    document.getElementById(
        "game-result-screen"
    ).style.display = "none";

    resetGame();

}

function buildReviewResultText() {

    if (gameResult === "draw") return "Draw";

    if (gameResult) return gameResult + " won";

    return "Imported game";

}


function reviewGame() {

    if (!finishedGamePGN) return;

    document.getElementById(
        "game-result-screen"
    ).style.display = "none";

    document.getElementById(
        "game-review-summary-screen"
    ).style.display = "flex";

    document.getElementById(
        "review-result"
    ).textContent = buildReviewResultText();

    reviewPositionGame = new Chess();

    reviewPositionGame.load_pgn(
        finishedGamePGN
    );

    reviewMoves =
        reviewPositionGame.history();

    reviewMoveIndex = 0;

    reviewPositionGame.reset();

    clearBoardMoveBadge();

    clearBoardBestMoveArrow();

    reviewBoard.position(
        reviewPositionGame.fen()
    );

    updateReviewMoveNumber();

    // Reset the summary panels while we (re)analyze.
    currentAnalysis = null;

    document.getElementById("white-accuracy").textContent = "—";
    document.getElementById("black-accuracy").textContent = "—";
    document.getElementById("move-analysis").textContent =
        "Analyzing the game with Stockfish...";

    const breakdownContainer = document.getElementById("breakdown-rows");
    if (breakdownContainer) breakdownContainer.innerHTML = "";

    showReviewMoves();

    updateEvalBar(0);

    // The board itself only opens once the summary is ready — see
    // startReviewBoard(), triggered from this button.
    const startBtn = document.getElementById("review-start-btn");
    if (startBtn) startBtn.disabled = true;

    const pgnForThisGame = finishedGamePGN;

    const cached = analysisCache[normalizeGameKey(pgnForThisGame)];

    if (cached) {

        currentAnalysis = cached;

        renderAnalysisSummary(cached);

        showReviewMoves();

        updateMoveAnalysisDisplay();

        if (startBtn) startBtn.disabled = false;

        return;

    }

    showAnalysisLoading(true, 0, reviewMoves.length + 1);

    analyzeGame(pgnForThisGame).then(function (analysis) {

        // Guard against the user having closed / changed screens,
        // or started a new game, while analysis was still running.
        if (finishedGamePGN !== pgnForThisGame) return;

        currentAnalysis = analysis;

        showAnalysisLoading(false);

        renderAnalysisSummary(analysis);

        showReviewMoves();

        updateMoveAnalysisDisplay();

        if (startBtn) startBtn.disabled = false;

    }).catch(function (err) {

        showAnalysisLoading(false);

        document.getElementById("review-result").textContent =
            "Analysis couldn't run. Make sure stockfish-19-lite-single.js " +
            "and stockfish-19-lite-single.wasm are saved in the same " +
            "folder as index.html.";

        // Let the person still look at the moves even without
        // engine classifications, rather than getting stuck here.
        if (startBtn) startBtn.disabled = false;

        console.error("Stockfish analysis failed:", err);

    });

}

// Shared by startReviewBoard() and the review screen's "Undo"
// button: rewinds the review board all the way back to move 0.
function resetReviewBoardToStart() {

    reviewMoveIndex = 0;

    reviewPositionGame.reset();

    clearBoardMoveBadge();

    clearBoardBestMoveArrow();

    reviewBoard.position(
        reviewPositionGame.fen()
    );

    updateReviewMoveNumber();

    updateMoveAnalysisDisplay();

}

// Opens the move-by-move board screen from the summary screen's
// "Start Review" button, always starting back at move 0.
function startReviewBoard() {

    document.getElementById(
        "game-review-summary-screen"
    ).style.display = "none";

    document.getElementById(
        "game-review-board-screen"
    ).style.display = "flex";

    resetReviewBoardToStart();

}

// Flips the review board's orientation, same as flipBoard() does
// for the live game board.
function flipReviewBoard() {

    const orientation = reviewBoard.orientation();

    reviewBoard.orientation(
        orientation === "white" ? "black" : "white"
    );

    // The arrow is a manually-positioned SVG overlay, not part of
    // chessboard.js's own DOM, so it doesn't move on its own when
    // the board flips — redraw it (if one's currently shown) using
    // the new orientation's coordinates.
    if (
        reviewMoveIndex > 0 &&
        currentAnalysis &&
        currentAnalysis.perMove[reviewMoveIndex - 1]
    ) {

        updateBestMoveArrowForEntry(
            currentAnalysis.perMove[reviewMoveIndex - 1]
        );

    }

}

// Back button on the summary screen — returns to the Game Over
// popup (two-player games) or straight back to the board
// (analysis-board games, which have no Game Over popup).
function closeGameReviewSummary() {

    document.getElementById(
        "game-review-summary-screen"
    ).style.display = "none";

    showAnalysisLoading(false);

    if (currentMode !== "analysis") {

        document.getElementById(
            "game-result-screen"
        ).style.display = "flex";

    }

}
    function reviewPreviousMove() {

    if (reviewMoveIndex <= 0) return;

    const undoneMoveIndex = reviewMoveIndex - 1;

    // Position of the move that will become the new "last move" after
    // this undo (one before the move being undone), so we can show
    // its badge instead once we're done.
    const newLastIndex = undoneMoveIndex - 1;

    // Replay from the start once to find the exact move being undone
    // (from/to/flags), so we can slide it back the same way the live
    // board animates moves — a plain reverse-slide only works cleanly
    // for a normal (non-capture, non-castle, non-promotion) move,
    // since chessboard.js can't "un-capture" a piece back into place.
    const replay = new Chess();

    let undoneMove = null;
    let newLastMove = null;

    for (let i = 0; i <= undoneMoveIndex; i++) {

        const mv = replay.move(reviewMoves[i]);

        if (i === undoneMoveIndex) {
            undoneMove = mv;
        }

        if (i === newLastIndex) {
            newLastMove = mv;
        }

    }

    reviewMoveIndex--;

    reviewPositionGame.reset();

    for (
        let i = 0;
        i < reviewMoveIndex;
        i++
    ) {

        reviewPositionGame.move(
            reviewMoves[i]
        );

    }

    const needsSnap =
        !undoneMove ||
        undoneMove.flags.includes('k') ||
        undoneMove.flags.includes('q') ||
        undoneMove.flags.includes('e') ||
        undoneMove.promotion ||
        undoneMove.captured;

    if (needsSnap) {

        reviewBoard.position(
            reviewPositionGame.fen()
        );

    } else {

        reviewBoard.move(
            undoneMove.to + '-' + undoneMove.from
        );

    }

    if (
        reviewMoveIndex > 0 &&
        newLastMove &&
        currentAnalysis &&
        currentAnalysis.perMove[reviewMoveIndex - 1]
    ) {

        showBoardMoveBadge(
            newLastMove.to,
            currentAnalysis.perMove[reviewMoveIndex - 1].classification
        );

        updateBestMoveArrowForEntry(
            currentAnalysis.perMove[reviewMoveIndex - 1]
        );

    } else {

        clearBoardMoveBadge();

        clearBoardBestMoveArrow();

    }

    updateReviewMoveNumber();

    updateMoveAnalysisDisplay();

}
    function reviewNextMove() {

    if (
        reviewMoveIndex >= reviewMoves.length
    ) return;

    const move = reviewPositionGame.move(
        reviewMoves[reviewMoveIndex]
    );

    reviewMoveIndex++;

    // Same animation rule the live game uses in handle(): castling,
    // en passant, and promotion need a full redraw, everything else
    // (including ordinary captures) can slide.
    if (
        move.flags.includes('k') ||
        move.flags.includes('q') ||
        move.flags.includes('e') ||
        move.promotion
    ) {

        reviewBoard.position(
            reviewPositionGame.fen()
        );

    } else {

        reviewBoard.move(
            move.from + '-' + move.to
        );

    }

    if (
        currentAnalysis &&
        currentAnalysis.perMove[reviewMoveIndex - 1]
    ) {

        showBoardMoveBadge(
            move.to,
            currentAnalysis.perMove[reviewMoveIndex - 1].classification
        );

        updateBestMoveArrowForEntry(
            currentAnalysis.perMove[reviewMoveIndex - 1]
        );

    } else {

        clearBoardMoveBadge();

        clearBoardBestMoveArrow();

    }

    updateReviewMoveNumber();

    updateMoveAnalysisDisplay();

}
    function updateReviewMoveNumber() {

    const moveNumber =
        document.getElementById(
            "review-move-number"
        );

    if (reviewMoveIndex === 0) {

        moveNumber.textContent =
            "Start";

        return;

    }

    moveNumber.textContent =
        "Move " + reviewMoveIndex +
        " / " + reviewMoves.length;

}
    function showReviewMoves() {

    const movesBox = document.getElementById(
        "review-moves"
    );

    movesBox.innerHTML = "";

    const moves = reviewMoves;

    for (
        let i = 0;
        i < moves.length;
        i += 2
    ) {

        const row = document.createElement(
            "div"
        );

        row.className =
            "review-move-row";

        const number =
            document.createElement("span");

        number.className =
            "review-move-number";

        number.textContent =
            (Math.floor(i / 2) + 1) + ".";

        const white =
            document.createElement("span");

        white.className =
            "review-white-move";

        white.appendChild(
            buildMoveLabel(moves[i], i)
        );

        const black =
            document.createElement("span");

        black.className =
            "review-black-move";

        if (moves[i + 1]) {

            black.appendChild(
                buildMoveLabel(moves[i + 1], i + 1)
            );

        }

        row.appendChild(number);

        row.appendChild(white);

        row.appendChild(black);

        movesBox.appendChild(row);

    }

}

    /* ========================================
       BUILD A SINGLE MOVE LABEL (with
       classification badge, once available)
    ======================================== */

    function buildMoveLabel(san, moveIndex) {

        const wrap = document.createElement("span");

        wrap.textContent = san;

        if (
            currentAnalysis &&
            currentAnalysis.perMove[moveIndex]
        ) {

            const cls =
                currentAnalysis.perMove[moveIndex].classification;

            const info = MOVE_CLASS[cls];

            if (info) {

                const badge =
                    document.createElement("span");

                badge.className = "move-class-badge";

                badge.style.background = info.color;

                badge.innerHTML = getMoveClassIconHTML(cls);

                badge.title = info.label;

                wrap.appendChild(badge);

            }

        }

        return wrap;

    }

    function closeGameReview() {

    document.getElementById(
        "game-review-board-screen"
    ).style.display = "none";

    // Board screen always came from the summary screen — go back
    // there rather than all the way out to the Game Over popup.
    document.getElementById(
        "game-review-summary-screen"
    ).style.display = "flex";

    resetReviewBoardToStart();

}

        /* ========================================
           STOCKFISH GAME ANALYSIS
        ======================================== */

        // Target depth 14, with a per-position time safety cap. Most
        // positions reach depth 14 in well under a second; a sharp
        // tactical position can occasionally take much longer than a
        // quiet one to reach the same depth, and without a cap that
        // one position stalls the whole game's review (analyzeGame
        // waits on every position before showing results). The cap
        // below bounds worst-case time per position while leaving the
        // common case — reaching full depth 14 quickly — untouched.
        const ANALYSIS_DEPTH = 14;
        const ANALYSIS_MOVETIME_MS = 4000;

        // Two PGNs for the same game can differ in move notation
        // (e.g. "Nf3" vs "Ng1-f3") while representing identical play.
        // Cache by the parsed, canonical SAN move list instead of the
        // raw PGN text so those variants share one cache entry.
        function normalizeGameKey(pgn) {

            const parsed = new Chess();

            if (!parsed.load_pgn(pgn)) {
                // Not valid PGN — fall back to the raw string so we
                // still get a stable (if less forgiving) cache key.
                return pgn;
            }

            return parsed.history().join(' ');

        }

        function analyzeGame(pgn) {

            const cacheKey = normalizeGameKey(pgn);

            if (analysisCache[cacheKey]) {
                return Promise.resolve(analysisCache[cacheKey]);
            }

            const tempGame = new Chess();

            tempGame.load_pgn(pgn);

            const sanMoves = tempGame.history();

            tempGame.reset();

            const fens = [tempGame.fen()];
            const moveObjs = [];

            for (let i = 0; i < sanMoves.length; i++) {

                moveObjs.push(tempGame.move(sanMoves[i]));

                fens.push(tempGame.fen());

            }

            // Fire evaluations for every position concurrently rather
            // than one-at-a-time — engine.js's worker pool picks these
            // up in parallel across however many workers it has, which
            // is where the real speedup comes from. Results can finish
            // out of order, so they're written into evals[idx] by
            // index rather than pushed as they arrive, and progress is
            // tracked by a separate completed-count.
            const evals = new Array(fens.length);

            let completedCount = 0;

            const evalPromises = fens.map(function (fen, idx) {

                // Positions with no legal moves (checkmate / stalemate)
                // can't be searched by the engine — score them directly
                // instead of sending them to Stockfish.
                const terminal = getTerminalEval(fen);

                if (terminal) {

                    evals[idx] = terminal;

                    completedCount++;

                    showAnalysisLoading(true, completedCount, fens.length);

                    return Promise.resolve();

                }

                return evaluatePosition(
                    fen,
                    ANALYSIS_DEPTH,
                    ANALYSIS_MOVETIME_MS
                ).then(function (result) {

                    evals[idx] = normalizeEval(result, fen);

                    completedCount++;

                    showAnalysisLoading(
                        true,
                        completedCount,
                        fens.length
                    );

                });

            });

            return Promise.all(evalPromises).then(function () {

                const analysis = buildAnalysisFromEvals(
                    sanMoves,
                    fens,
                    evals,
                    moveObjs
                );

                analysisCache[cacheKey] = analysis;

                return analysis;

            });

        }

        // Converts a raw engine result (relative to the side to move)
        // into a score relative to White, and turns mate scores into
        // a large-but-bounded centipawn-equivalent number.
        function toWhiteCp(sideToMove, cp, mate) {

            let value;

            if (mate !== null && mate !== undefined) {

                const magnitude = 10000 - Math.min(Math.abs(mate) * 50, 9000);

                value = mate > 0 ? magnitude : -magnitude;

            } else {

                value = cp || 0;

            }

            if (sideToMove === "b") {
                value = -value;
            }

            return value;

        }

        function normalizeEval(result, fen) {

            const sideToMove = fen.split(" ")[1];

            const cpWhite = toWhiteCp(sideToMove, result.cp, result.mate);

            const hasSecond =
                (result.secondCp !== null && result.secondCp !== undefined) ||
                (result.secondMate !== null && result.secondMate !== undefined);

            const secondCpWhite = hasSecond
                ? toWhiteCp(sideToMove, result.secondCp, result.secondMate)
                : null;

            return {
                cp: cpWhite,
                mate: result.mate,
                bestMove: result.bestMove,
                secondCp: secondCpWhite,
                sideToMove: sideToMove,
                depthReached: result.depthReached,
                depthRequested: result.depthRequested,
                timeCapped: result.timeCapped
            };

        }

        // Approximates whether a move was a sound sacrifice: the mover
        // gives up more material than they immediately gained, the
        // opponent has a way to take the piece for cheap or free, and
        // yet the engine still says this move is best. That combination
        // is the hallmark of a "Brilliant" move.
        // leniency > 1 (lower-rated player) allows a slightly more
        // expensive recapture to still count as "safe enough to call
        // this a sacrifice" — chess.com notes they use a "more
        // generous" sacrifice definition for newer players.
        //
        // Critical extra check (this was the actual bug): a piece
        // being capturable by an equal-value piece is NOT by itself a
        // sacrifice — that's just an ordinary trade. d4 being capturable
        // by ...cxd4, or Qxc4 being capturable by ...Qxc4, both looked
        // like "sacrifices" under the old logic purely because a pawn
        // can take a pawn or a queen can take a queen. The real test of
        // a sacrifice is whether the material actually stays lost: after
        // the opponent's recapture, can the ORIGINAL mover immediately
        // retake on that same square and restore the balance? If so,
        // it's a normal trade/combination, not a sacrifice, no matter
        // how the single-move material looked in isolation.
        function isLikelySacrifice(fenAfter, moveObj, leniency) {

            if (!moveObj) return false;

            const moverValue = PIECE_VALUE[moveObj.piece] || 0;

            if (moverValue === 0) return false;

            const capturedValue =
                moveObj.captured ? (PIECE_VALUE[moveObj.captured] || 0) : 0;

            let afterGame;

            try {
                afterGame = new Chess(fenAfter);
            } catch (e) {
                return false;
            }

            const oppMoves = afterGame.moves({ verbose: true });

            let cheapestRecapture = null;
            let cheapestRecaptureSAN = null;

            oppMoves.forEach(function (m) {

                const isCapture =
                    m.flags.indexOf("c") !== -1 || m.flags.indexOf("e") !== -1;

                if (m.to === moveObj.to && isCapture) {

                    const attackerValue = PIECE_VALUE[m.piece] || 0;

                    if (
                        cheapestRecapture === null ||
                        attackerValue < cheapestRecapture
                    ) {
                        cheapestRecapture = attackerValue;
                        cheapestRecaptureSAN = m.san;
                    }

                }

            });

            if (cheapestRecapture === null) return false;

            const netMaterial = capturedValue - moverValue;

            const cushion = ((leniency || 1) - 1) * 1.0;

            const looksLikeSacOnThisMoveAlone =
                netMaterial < 0 && cheapestRecapture <= moverValue + cushion;

            if (!looksLikeSacOnThisMoveAlone) return false;

            // Now the extra check: after the opponent takes back, can
            // the original mover immediately restore the material on
            // the same square? If yes, this was just a trade.
            let afterRecaptureGame;

            try {

                afterRecaptureGame = new Chess(afterGame.fen());
                afterRecaptureGame.move(cheapestRecaptureSAN);

            } catch (e) {

                // If we can't even replay the recapture, fall back to
                // the single-move signal rather than blocking on it.
                return true;

            }

            const canImmediatelyRestore =
                afterRecaptureGame.moves({ verbose: true }).some(function (m) {

                    const isCapture =
                        m.flags.indexOf("c") !== -1 || m.flags.indexOf("e") !== -1;

                    // Any legal recapture on that square restores the
                    // lost value, regardless of which of the mover's
                    // pieces does it — capturing the bishop that just
                    // took your knight with your queen still nets you
                    // back a full knight's worth of material; which
                    // piece performs the recapture doesn't change that.
                    return isCapture && m.to === moveObj.to;

                });

            return !canImmediatelyRestore;

        }

        // Scores a position that has no legal moves (checkmate or
        // stalemate/draw) without asking the engine, since Stockfish
        // has nothing to search there.
        function getTerminalEval(fen) {

            let temp;

            try {
                temp = new Chess(fen);
            } catch (e) {
                return null;
            }

            if (!temp.game_over()) return null;

            const sideToMove = fen.split(" ")[1];

            if (temp.in_checkmate()) {

                // The side to move has been mated, so the position is
                // maximally bad for them and maximally good for the
                // other side.
                const cpForSideToMove = -9950;

                const cpWhite =
                    sideToMove === "w" ? cpForSideToMove : -cpForSideToMove;

                return {
                    cp: cpWhite,
                    mate: null,
                    bestMove: null,
                    secondCp: null,
                    sideToMove: sideToMove,
                    depthReached: null,
                    depthRequested: null,
                    timeCapped: false
                };

            }

            // Stalemate, insufficient material, 50-move rule, repetition.
            return {
                cp: 0,
                mate: null,
                bestMove: null,
                secondCp: null,
                sideToMove: sideToMove,
                depthReached: null,
                depthRequested: null,
                timeCapped: false
            };

        }

        // Converts a White-perspective centipawn score into a 0-100
        // win-percentage for White, using the same logistic curve
        // Lichess/chess.com-style accuracy tools use. This keeps huge
        // mate scores from dominating the accuracy math.
        //
        // Rating adjustment: chess.com's real "Expected Points Model"
        // derives win/expected-points from BOTH the engine eval AND
        // the player's rating (their exact curve isn't published).
        // This approximates that same idea rather than reproducing
        // their precise numbers: the curve is made steeper for higher
        // ratings (a given centipawn edge counts as more decisive,
        // since strong players convert advantages more reliably) and
        // flatter for lower ratings (the same edge is treated as less
        // certain, since it's more likely to slip away). ratingSteepnessFactor
        // is 1.0 at the 1500 baseline.
        function winPercentWhite(cp) {

            const steepness = 0.00368208 * ratingSteepnessFactor(playerRating);

            return 100 / (1 + Math.exp(-steepness * cp));

        }

        function ratingSteepnessFactor(rating) {

            const factor = rating / 1500;

            return Math.min(1.4, Math.max(0.6, factor));

        }

        // Used only for the three special classifications (Great,
        // Brilliant, Miss) — chess.com explicitly says these are "more
        // generous... for new players compared to higher-rated
        // players." 1.0 at the 1500 baseline; >1 (more lenient) below
        // it, <1 (stricter) above it.
        function ratingLeniency(rating) {

            const factor = 1500 / Math.max(600, rating);

            return Math.min(1.6, Math.max(0.7, factor));

        }

        // Converts the win% drop caused by a single move into a 0-100
        // accuracy score for that move.
        function moveAccuracyFromWinDrop(winBefore, winAfter) {

            const drop = Math.max(0, winBefore - winAfter);

            let acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;

            if (acc > 100) acc = 100;
            if (acc < 0) acc = 0;

            return acc;

        }

        // Converts a UCI move (e.g. "e2e4", "e7e8q") played from a
        // given FEN into its SAN notation (e.g. "e4", "e8=Q").
        function uciToSan(fen, uci) {

            if (!uci || uci.length < 4 || uci === "(none)") return null;

            try {

                const temp = new Chess(fen);

                const from = uci.substring(0, 2);
                const to = uci.substring(2, 4);
                const promotion = uci.length > 4 ? uci.substring(4, 5) : undefined;

                const move = temp.move({
                    from: from,
                    to: to,
                    promotion: promotion || "q"
                });

                return move ? move.san : null;

            } catch (e) {

                return null;

            }

        }

        // Standard piece values in pawns, used only for the SEE
        // exchange math below (not the engine's own evaluation).
        function pieceValue(type) {

            switch (type) {
                case "p": return 1;
                case "n": return 3;
                case "b": return 3;
                case "r": return 5;
                case "q": return 9;
                default: return 0; // king can't be captured
            }

        }

        // Looks up what piece (if any) sits on a square in a given
        // FEN, without mutating or needing the caller to construct a
        // Chess instance themselves.
        function getFenPieceAt(fen, square) {

            try {
                return new Chess(fen).get(square);
            } catch (e) {
                return null;
            }

        }

        function pieceFullName(type) {

            switch (type) {
                case "p": return "pawn";
                case "n": return "knight";
                case "b": return "bishop";
                case "r": return "rook";
                case "q": return "queen";
                case "k": return "king";
                default: return "piece";
            }

        }

        // ============================================================
        // STATIC EXCHANGE EVALUATION (SEE)
        // ------------------------------------------------------------
        // Given a position and a square, simulates the *full* forced
        // capture sequence on that square — each side always
        // recapturing with its cheapest attacker, exactly the way
        // engines validate whether a capture is actually sound — and
        // folds the result back into a single number via the standard
        // minimax "swap" algorithm: a rational side stops capturing
        // the moment continuing would only cost it more material.
        //
        // Unlike pattern-matching on the engine's single top line,
        // this only reports a piece as "hanging" when the full
        // exchange genuinely nets material — it correctly handles
        // defended pieces, x-ray attackers revealed mid-exchange
        // (chess.js recomputes legal moves from the live board after
        // each simulated capture), and pinned attackers (an attacker
        // pinned to its king simply won't appear in the legal move
        // list chess.js returns).
        //
        // Returns the net material result, in pawns, for the side to
        // move in `fen` if they optimally initiate captures on
        // `square`. Positive = that side profits.
        // ============================================================
        function staticExchangeEval(fen, square) {

            const game = new Chess(fen);

            const occupant = game.get(square);

            if (!occupant) return 0;

            const gain = [pieceValue(occupant.type)];

            let depth = 0;

            // Safety cap — a real capture sequence on one square is
            // never remotely this long; this just guards against any
            // unforeseen loop in a pathological position.
            while (depth < 31) {

                const attackers = game.moves({ verbose: true })
                    .filter(function (m) { return m.to === square; });

                if (attackers.length === 0) break;

                // Always recapture with the cheapest attacker — the
                // standard SEE simplification, and the rational choice
                // in the vast majority of real positions.
                attackers.sort(function (a, b) {
                    return pieceValue(a.piece) - pieceValue(b.piece);
                });

                const mv = attackers[0];

                depth++;

                gain[depth] = pieceValue(mv.piece) - gain[depth - 1];

                game.move({
                    from: mv.from,
                    to: mv.to,
                    promotion: mv.promotion || "q"
                });

            }

            // No legal attacker at all (e.g. checking a square nobody
            // can actually reach) — nothing to win, regardless of
            // what happens to be sitting there.
            if (depth === 0) return 0;

            // Fold back from the last capture: each side only takes
            // if doing so beats simply stopping. Note this starts at
            // depth-2, not depth-1 — gain[depth-1] is only ever read
            // here (to fold into gain[depth-2]), never itself
            // overwritten, matching the standard swap algorithm.
            for (let i = depth - 2; i >= 0; i--) {
                gain[i] = -Math.max(-gain[i], gain[i + 1]);
            }

            return gain[0];

        }

        function emptyCounts() {

            return {
                brilliant: 0,
                great: 0,
                book: 0,
                best: 0,
                excellent: 0,
                good: 0,
                inaccuracy: 0,
                mistake: 0,
                miss: 0,
                blunder: 0
            };

        }

        // "Failed to punish the opponent's own blunder": the previous
        // move (by the opponent) already dropped their win% enough to
        // be classified blunder or mistake — meaning a real
        // opportunity just appeared — and this move gave back a
        // meaningful chunk of it (>= the mistake-level win-drop
        // threshold). Unlike isMissTransition below, this doesn't
        // require ending up below some absolute win% floor: giving
        // back a big chunk of a gifted advantage is a Miss whether
        // you're left merely "still winning but less so" or all the
        // way back to equal/losing. perMove[k - 1] is safe to read
        // here — entries are pushed in move order, so the opponent's
        // move (k - 1) is already finalized by the time move k is
        // classified.
        function isMissOpportunity(k, perMove, winDrop) {

            if (k === 0 || !perMove[k - 1]) return false;

            const opponentBlundered =
                perMove[k - 1].classification === "blunder" ||
                perMove[k - 1].classification === "mistake";

            return opponentBlundered && winDrop >= 10;

        }

        // "Failing to capitalize on the opponent's mistake": you were
        // clearly winning before this move, and after it you no
        // longer are. Bar widths nudge in chess.com's stated direction
        // — more generous (harder to trigger) for lower-rated players.
        function isMissTransition(winBeforeMover, winAfterMover, leniency) {

            const wasWinningBar =
                Math.min(85, Math.max(55, 65 + (leniency - 1) * 20));

            const stillOkBar =
                Math.min(60, Math.max(30, 50 - (leniency - 1) * 15));

            return winBeforeMover >= wasWinningBar &&
                winAfterMover < stillOkBar;

        }

        // Buckets a mover's win% into "losing" / "equal" / "winning",
        // used to detect the transitions chess.com's support article
        // names explicitly for Great Move: "turning a losing position
        // into an equal one, an equal position into a winning one".
        // Zone widths widen for lower-rated players (same leniency
        // direction as everywhere else), so the same eval swing is a
        // little more likely to count as crossing a zone boundary.
        function winZone(win, leniency) {

            const losingBar =
                Math.min(40, Math.max(25, 35 - (leniency - 1) * 10));

            const winningBar =
                Math.min(75, Math.max(60, 65 + (leniency - 1) * 10));

            if (win < losingBar) return "losing";
            if (win > winningBar) return "winning";
            return "equal";

        }

        function buildAnalysisFromEvals(sanMoves, fens, evals, moveObjs) {

            const perMove = [];

            const whiteMoveAccuracies = [];
            const blackMoveAccuracies = [];

            const whiteCounts = emptyCounts();
            const blackCounts = emptyCounts();

            for (let k = 0; k < sanMoves.length; k++) {

                const moverIsWhite = (k % 2 === 0);

                const evalBeforeWhite = evals[k].cp;
                const evalAfterWhite = evals[k + 1].cp;

                const moverEvalBefore =
                    moverIsWhite ? evalBeforeWhite : -evalBeforeWhite;

                const moverEvalAfter =
                    moverIsWhite ? evalAfterWhite : -evalAfterWhite;

                let cpLoss = moverEvalBefore - moverEvalAfter;

                if (cpLoss < 0) cpLoss = 0;

                // Accuracy is based on the drop in win-percentage this
                // move caused (mover's perspective), not raw centipawns,
                // so mate scores can't blow the average up or down.
                const winBeforeWhite = winPercentWhite(evalBeforeWhite);
                const winAfterWhite = winPercentWhite(evalAfterWhite);

                const winBeforeMover =
                    moverIsWhite ? winBeforeWhite : 100 - winBeforeWhite;

                const winAfterMover =
                    moverIsWhite ? winAfterWhite : 100 - winAfterWhite;

                const moveAccuracy =
                    moveAccuracyFromWinDrop(winBeforeMover, winAfterMover);

                // Used for classification thresholds below — how much
                // the move's win% dropped, same scale chess.com/Lichess
                // classify moves on (not raw centipawns).
                const winDrop = Math.max(0, winBeforeMover - winAfterMover);

                const bestMoveSAN = uciToSan(fens[k], evals[k].bestMove);

                const matchesBest =
                    bestMoveSAN !== null && sanMoves[k] === bestMoveSAN;

                // No hard ply cap here — the trie itself stops
                // matching the moment the game leaves known theory,
                // so this naturally covers short and long book lines
                // alike instead of an arbitrary "first 10 moves" cutoff.
                //
                // Being on a catalogued line is not enough by itself:
                // the ECO/lichess dataset also names well-known TRAPS
                // (e.g. the Scholar's Mate setup, e4 e5 Bc4 Bc5 Qh5
                // Nf6??), so a move that is technically "in the book"
                // can still be the losing blunder that walks into
                // mate. Book only wins the classification when the
                // move didn't also blow the evaluation — otherwise it
                // falls through to the normal win%-drop based grading
                // below, same as chess.com not letting "book" mask an
                // actual disaster.
                const isBook = isBookMove(sanMoves, k) && winDrop < 20;

                // Delivering checkmate is always the objectively best
                // possible move, even on the rare occasion the engine's
                // own top line pointed at a *different* mate (multiple
                // mates can tie for best), which would otherwise make
                // matchesBest false for a move that's clearly correct.
                const deliversCheckmate = sanMoves[k].indexOf("#") !== -1;

                const leniency = ratingLeniency(playerRating);

                let cls;

                if (deliversCheckmate) {

                    cls = "best";

                } else if (isBook) {

                    cls = "book";

                } else if (matchesBest) {

                    // Figure out if this "best" move is also Great (the
                    // only good option — a big win% drop-off to the
                    // 2nd-best line) or Brilliant (a sound sacrifice
                    // that's still clearly winning). Both checks use
                    // win% here too, for the same reason as the main
                    // classification thresholds below — a big raw
                    // centipawn gap between the best and 2nd-best move
                    // means nothing if the position is already totally
                    // decided either way.
                    const secondCpWhite = evals[k].secondCp;

                    let gapToSecondWinPercent = null;

                    if (secondCpWhite !== null) {

                        const secondWinWhite = winPercentWhite(secondCpWhite);

                        const secondWinMover =
                            moverIsWhite ? secondWinWhite : 100 - secondWinWhite;

                        gapToSecondWinPercent = winBeforeMover - secondWinMover;

                    }

                    const moveObj = moveObjs ? moveObjs[k] : null;

                    const sac =
                        moveObj && fens[k + 1]
                            ? isLikelySacrifice(fens[k + 1], moveObj, leniency)
                            : false;

                    // Brilliant per chess.com's simplified definition:
                    // a good sacrifice you weren't forced into — with
                    // two extra conditions: not in a bad position
                    // after it, and not already completely winning
                    // even without finding it. brilliantMaxPriorWin is
                    // that second condition's ceiling, nudged higher
                    // (more forgiving) for lower-rated players.
                    const brilliantMaxPriorWin =
                        Math.min(95, Math.max(80, 88 + (leniency - 1) * 8));

                    // Great's required gap to the 2nd-best line is
                    // smaller (easier to qualify) for lower-rated
                    // players, per the same stated leniency.
                    const greatGapThreshold =
                        Math.min(25, Math.max(8, 15 / leniency));

                    // Per chess.com's support article, a Great Move is
                    // "critical to the outcome of the game" — either
                    // (a) it was the only good move in the position
                    // (large win% gap to the 2nd-best line), OR (b) it
                    // was a critical zone transition: losing -> equal,
                    // losing -> winning, or equal -> winning.
                    const zoneBefore = winZone(winBeforeMover, leniency);
                    const zoneAfter = winZone(winAfterMover, leniency);

                    const isCriticalTransition =
                        (zoneBefore === "losing" && zoneAfter === "equal") ||
                        (zoneBefore === "losing" && zoneAfter === "winning") ||
                        (zoneBefore === "equal" && zoneAfter === "winning");

                    const isOnlyGoodMove =
                        gapToSecondWinPercent !== null &&
                        gapToSecondWinPercent >= greatGapThreshold;

                    if (
                        sac &&
                        winAfterMover > 60 &&
                        winBeforeMover < brilliantMaxPriorWin
                    ) {

                        cls = "brilliant";

                    } else if (
                        (isCriticalTransition || isOnlyGoodMove) &&
                        winAfterMover > 30
                    ) {

                        cls = "great";

                    } else {

                        cls = "best";

                    }

                } else if (isMissOpportunity(k, perMove, winDrop)) {

                    cls = "miss";

                } else if (isMissTransition(winBeforeMover, winAfterMover, leniency)) {

                    cls = "miss";

                } else if (winDrop < 2) {

                    cls = "excellent";

                } else if (winDrop < 5) {

                    cls = "good";

                } else if (winDrop < 10) {

                    cls = "inaccuracy";

                } else if (winDrop < 20) {

                    cls = "mistake";

                } else {

                    cls = "blunder";

                }

                // ----------------------------------------------------
                // WHY was this move bad? The engine already searched
                // the position AFTER the move as part of judging the
                // *next* move (evals[k+1]) — its top line there is a
                // candidate for the opponent's punishment, reused here
                // at no extra engine cost. But a single top line isn't
                // proof of anything by itself, so every specific claim
                // below is verified with SEE (see staticExchangeEval)
                // before it's stated. Anything we can't verify falls
                // back to a plain, factual eval statement instead of
                // an unverified tactical guess.
                // ----------------------------------------------------
                const punishEval = evals[k + 1];

                const punishUCI = punishEval ? punishEval.bestMove : null;

                const punishSAN = punishUCI
                    ? uciToSan(fens[k + 1], punishUCI)
                    : null;

                // punishEval.mate is from the opponent's (side-to-move
                // at k+1) perspective, so > 0 means the blunder just
                // walked into a forced mate for them. This is exact
                // (a mate score, not a heuristic), so it's always
                // safe to state outright.
                const allowsForcedMate =
                    !!punishEval &&
                    punishEval.mate !== null &&
                    punishEval.mate !== undefined &&
                    punishEval.mate > 0;

                const movedTo = moveObjs && moveObjs[k] ? moveObjs[k].to : null;
                const movedPieceType = moveObjs && moveObjs[k] ? moveObjs[k].piece : null;

                // Verified check #1: is the piece just moved actually
                // hanging? Run the full capture sequence on its square
                // — this only fires if the exchange genuinely nets the
                // opponent material (a full pawn or more), so a
                // defended piece never gets falsely called "hanging".
                let seeAtMovedSquare = 0;

                if (!allowsForcedMate && movedTo) {
                    seeAtMovedSquare = staticExchangeEval(fens[k + 1], movedTo);
                }

                const hangsPieceJustMoved =
                    !allowsForcedMate && seeAtMovedSquare >= 1;

                // Verified check #2: does the engine's suggested reply
                // capture somewhere, and does SEE confirm THAT square
                // is also a genuine material win (covers hanging a
                // piece other than the one just moved)?
                let seeAtPunishSquare = 0;
                let punishTargetSquare = null;

                if (
                    !allowsForcedMate &&
                    !hangsPieceJustMoved &&
                    punishSAN &&
                    punishSAN.indexOf("x") !== -1 &&
                    punishUCI
                ) {

                    punishTargetSquare = punishUCI.substring(2, 4);

                    seeAtPunishSquare =
                        staticExchangeEval(fens[k + 1], punishTargetSquare);

                }

                const confirmsOtherHang =
                    !allowsForcedMate &&
                    !hangsPieceJustMoved &&
                    seeAtPunishSquare >= 1;

                let why = null;

                if (
                    cls === "blunder" ||
                    cls === "mistake" ||
                    cls === "inaccuracy" ||
                    cls === "miss"
                ) {

                    if (allowsForcedMate) {

                        why = "Allows a forced mate in " +
                            punishEval.mate +
                            (punishEval.mate === 1 ? " move" : " moves") +
                            (punishSAN ? " (starting with " + punishSAN + ")." : ".");

                    } else if (hangsPieceJustMoved) {

                        why = "Hangs the " + pieceFullName(movedPieceType) +
                            " on " + movedTo +
                            " (loses roughly " +
                            Math.round(seeAtMovedSquare) + " point" +
                            (Math.round(seeAtMovedSquare) === 1 ? "" : "s") +
                            " of material there).";

                    } else if (confirmsOtherHang) {

                        const hungPiece = getFenPieceAt(
                            fens[k + 1],
                            punishTargetSquare
                        );

                        why = "Leaves the " +
                            pieceFullName(hungPiece ? hungPiece.type : null) +
                            " on " + punishTargetSquare +
                            " undefended — " + punishSAN + " wins it.";

                    } else if (punishSAN) {

                        // Nothing here was verifiable with SEE (could
                        // be a positional idea, a quiet maneuver, or a
                        // multi-move combination) — state only the
                        // fact we're sure of: the evaluation swing and
                        // the engine's suggested reply, without
                        // asserting a specific tactic we can't confirm.
                        why = "Stockfish's suggested follow-up here is " +
                            punishSAN + ".";

                    }

                }

                perMove.push({
                    index: k,
                    san: sanMoves[k],
                    moverIsWhite: moverIsWhite,
                    cpLoss: Math.round(cpLoss),
                    moveAccuracy: Math.round(moveAccuracy * 10) / 10,
                    classification: cls,
                    evalAfterWhitePerspective: evalAfterWhite,
                    mateAfter: evals[k + 1].mate,
                    bestMoveSAN: bestMoveSAN,
                    bestMoveUCI: evals[k].bestMove,
                    matchesBest: matchesBest,
                    why: why,
                    // Depth actually reached when this move was judged
                    // (i.e. searching the position before the move, to
                    // decide what the best move was). Usually equals
                    // ANALYSIS_DEPTH; engineDepthCapped is true when the
                    // ANALYSIS_MOVETIME_MS safety cap cut the search
                    // short of that target on a slow position.
                    engineDepth: evals[k].depthReached,
                    engineDepthCapped: evals[k].timeCapped
                });

                if (cls !== "book") {

                    if (moverIsWhite) {
                        whiteMoveAccuracies.push(moveAccuracy);
                    } else {
                        blackMoveAccuracies.push(moveAccuracy);
                    }

                }

                const counts = moverIsWhite ? whiteCounts : blackCounts;

                counts[cls] = (counts[cls] || 0) + 1;

            }

            return {
                perMove: perMove,
                whiteAccuracy: averageAccuracy(whiteMoveAccuracies),
                blackAccuracy: averageAccuracy(blackMoveAccuracies),
                whiteCounts: whiteCounts,
                blackCounts: blackCounts
            };

        }

        // Combines per-move accuracy scores into one game accuracy
        // number. A plain average lets a handful of great moves mask
        // a real blunder, so — the same way Lichess's accuracy stat
        // works — we blend the plain average with the harmonic mean,
        // which is pulled down much harder by low outliers. That
        // makes a single big blunder cost noticeably more, closer to
        // what chess.com shows, instead of getting smoothed away.
        function harmonicMean(values) {

            if (values.length === 0) return 100;

            const denom = values.reduce(function (sum, v) {
                return sum + 1 / Math.max(v, 0.1);
            }, 0);

            return values.length / denom;

        }

        function averageAccuracy(accs) {

            if (accs.length === 0) return 100;

            const mean =
                accs.reduce(function (a, b) { return a + b; }, 0) /
                accs.length;

            const blended = (mean + harmonicMean(accs)) / 2;

            return Math.round(blended * 10) / 10;

        }

        /* ========================================
           ANALYSIS LOADING / PROGRESS UI
        ======================================== */

        function showAnalysisLoading(show, done, total) {

            const overlay = document.getElementById("review-loading");

            if (!overlay) return;

            overlay.style.display = show ? "flex" : "none";

            if (!show) return;

            const text = document.getElementById("review-loading-text");
            const fill = document.getElementById("review-progress-fill");

            if (typeof total === "number" && total > 0) {

                const pct = Math.round(((done || 0) / total) * 100);

                if (text) {
                    text.textContent =
                        "Analyzing with Stockfish... (" +
                        (done || 0) + " / " + total + ")";
                }

                if (fill) {
                    fill.style.width = pct + "%";
                }

            } else {

                if (text) {
                    text.textContent = "Analyzing with Stockfish...";
                }

                if (fill) {
                    fill.style.width = "0%";
                }

            }

        }

        /* ========================================
           RENDER ANALYSIS SUMMARY
        ======================================== */

        function renderAnalysisSummary(analysis) {

            document.getElementById("white-accuracy").textContent =
                analysis.whiteAccuracy + "%";

            document.getElementById("black-accuracy").textContent =
                analysis.blackAccuracy + "%";

            renderBreakdown(analysis);

        }

        // Fixed display order for the Move Breakdown table, matching
        // the layout of chess.com's game review summary.
        const BREAKDOWN_ORDER = [
            "brilliant", "great", "best", "excellent", "good",
            "book", "inaccuracy", "mistake", "miss", "blunder"
        ];

        function renderBreakdown(analysis) {

            const container = document.getElementById("breakdown-rows");

            if (!container) return;

            container.innerHTML = "";

            BREAKDOWN_ORDER.forEach(function (key) {

                const info = MOVE_CLASS[key];

                const whiteCount = analysis.whiteCounts[key] || 0;
                const blackCount = analysis.blackCounts[key] || 0;

                const row = document.createElement("div");
                row.className = "breakdown-row";

                const label = document.createElement("span");
                label.className = "breakdown-label";
                label.textContent = info.label;

                const whiteEl = document.createElement("span");
                whiteEl.className = "breakdown-count";
                whiteEl.style.color = info.color;
                whiteEl.textContent = whiteCount;

                const iconEl = document.createElement("span");
                iconEl.className = "breakdown-icon";
                iconEl.style.background = info.color;
                iconEl.innerHTML = getMoveClassIconHTML(key);

                const blackEl = document.createElement("span");
                blackEl.className = "breakdown-count";
                blackEl.style.color = info.color;
                blackEl.textContent = blackCount;

                row.appendChild(label);
                row.appendChild(whiteEl);
                row.appendChild(iconEl);
                row.appendChild(blackEl);

                container.appendChild(row);

            });

        }

        /* ========================================
           PER-MOVE ANALYSIS DISPLAY (speech bubble)
        ======================================== */

        function updateMoveAnalysisDisplay() {

            const box = document.getElementById("move-analysis");

            if (!box) return;

            if (!currentAnalysis) {

                box.textContent = "Analyzing the game with Stockfish...";

                return;

            }

            if (reviewMoveIndex === 0) {

                box.textContent = "Start of the game.";

                updateEvalBar(0);

                return;

            }

            const m = currentAnalysis.perMove[reviewMoveIndex - 1];

            if (!m) return;

            const info = MOVE_CLASS[m.classification];

            let text = info.icon + " " + m.san + " — " + info.label + ".";

            if (
                m.classification !== "best" &&
                m.classification !== "book" &&
                m.bestMoveSAN
            ) {

                text += " Best was " + m.bestMoveSAN + ".";

            }

            if (m.why) {

                text += " " + m.why;

            }

            text += " Eval: " + formatEval(m.evalAfterWhitePerspective, m.mateAfter);

            if (m.engineDepth !== null && m.engineDepth !== undefined) {

                text += " (engine depth " + m.engineDepth +
                    (m.engineDepthCapped ? ", time-capped" : "") + ")";

            }

            box.textContent = text;

            updateEvalBar(m.evalAfterWhitePerspective);

        }

        function formatEval(cp, mate) {

            if (mate) {
                return (mate > 0 ? "#" : "-#") + Math.abs(mate);
            }

            // Terminal checkmate positions are scored with a large
            // saturated cp value rather than a real mate count.
            if (Math.abs(cp) >= 9000) {
                return cp > 0 ? "Checkmate (White wins)" : "Checkmate (Black wins)";
            }

            const pawns = (cp / 100).toFixed(2);

            return (cp >= 0 ? "+" : "") + pawns;

        }

        function updateEvalBar(cpWhitePerspective) {

            const fill = document.getElementById("eval-bar-fill");

            if (!fill) return;

            const clamped =
                Math.max(-800, Math.min(800, cpWhitePerspective || 0));

            const pct = 50 + (clamped / 800) * 50;

            fill.style.height = pct + "%";

        }

        /* ========================================
           ON-BOARD MOVE CLASSIFICATION BADGE
           (the small icon shown on the square the
           last-played move landed on)
        ======================================== */

        function clearBoardMoveBadge() {

            const existing = document.querySelector(
                "#review-board .board-move-badge"
            );

            if (existing) existing.remove();

        }

        function showBoardMoveBadge(square, classification) {

            clearBoardMoveBadge();

            if (!square || !classification) return;

            const info = MOVE_CLASS[classification];

            if (!info) return;

            const squareEl = document.querySelector(
                '#review-board [data-square="' + square + '"]'
            );

            if (!squareEl) return;

            const badge = document.createElement("div");

            badge.className = "board-move-badge";

            badge.style.background = info.color;

            badge.innerHTML = getMoveClassIconHTML(classification);

            squareEl.appendChild(badge);

        }

        /* ---------- Best-move arrow (game review, like chess.com) ---------- */

        // Files a-h -> 0-7, ranks 1-8 -> board row 0-7 counting from the
        // top. Accounts for the review board's orientation (it can now
        // be flipped via the Flip button) so the arrow overlay lines up
        // with wherever chessboard.js actually drew each square.
        function squareToBoardXY(square) {

            const file = square.charCodeAt(0) - "a".charCodeAt(0);
            const rank = parseInt(square[1], 10);

            const flipped = reviewBoard.orientation() === "black";

            const col = flipped ? 7 - file : file;
            const row = flipped ? rank - 1 : 8 - rank;

            return {
                x: col + 0.5,
                y: row + 0.5
            };

        }

        function clearBoardBestMoveArrow() {

            const existing = document.getElementById(
                "review-board-arrow-layer"
            );

            if (existing) existing.remove();

        }

        // Draws a chess.com-style "here's the better move" arrow on the
        // review board, from `fromSquare` to `toSquare` (both algebraic,
        // e.g. "e2"/"e4"). Purely a geometric overlay independent of
        // whatever piece is currently sitting on those squares — the
        // same convention chess.com's own review arrows use, since the
        // square the piece actually moved from is empty by the time
        // we're looking at the resulting position.
        function showBoardBestMoveArrow(fromSquare, toSquare) {

            clearBoardBestMoveArrow();

            if (!fromSquare || !toSquare) return;

            const boardEl = document.getElementById("review-board");

            if (!boardEl) return;

            // Same green used for the "Best" badge elsewhere in the
            // app, so the arrow reads as "this is what Best looked
            // like here" rather than an unrelated new color.
            const arrowColor = MOVE_CLASS.best.color;

            const from = squareToBoardXY(fromSquare);
            const to = squareToBoardXY(toSquare);

            // Pull the line's endpoint back from the square center so
            // the arrowhead doesn't sit dead-center on the destination
            // square, and pull the start out slightly from center too
            // — same visual proportions chess.com's own arrows use.
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / len;
            const uy = dy / len;

            const startX = from.x + ux * 0.18;
            const startY = from.y + uy * 0.18;
            const endX = to.x - ux * 0.38;
            const endY = to.y - uy * 0.38;

            const svgNS = "http://www.w3.org/2000/svg";

            const svg = document.createElementNS(svgNS, "svg");

            svg.setAttribute("id", "review-board-arrow-layer");
            svg.setAttribute("viewBox", "0 0 8 8");
            svg.setAttribute("preserveAspectRatio", "none");
            svg.style.position = "absolute";
            svg.style.top = "0";
            svg.style.left = "0";
            svg.style.width = "100%";
            svg.style.height = "100%";
            svg.style.pointerEvents = "none";
            svg.style.zIndex = "6";

            const marker = document.createElementNS(svgNS, "marker");

            marker.setAttribute("id", "review-arrow-head");
            marker.setAttribute("viewBox", "0 0 10 10");
            marker.setAttribute("refX", "6");
            marker.setAttribute("refY", "5");
            marker.setAttribute("markerWidth", "4.2");
            marker.setAttribute("markerHeight", "4.2");
            marker.setAttribute("orient", "auto-start-reverse");

            const markerPath = document.createElementNS(svgNS, "path");

            markerPath.setAttribute("d", "M0,0 L10,5 L0,10 Z");
            markerPath.setAttribute("fill", arrowColor);
            markerPath.setAttribute("fill-opacity", "0.9");

            marker.appendChild(markerPath);

            const defs = document.createElementNS(svgNS, "defs");

            defs.appendChild(marker);
            svg.appendChild(defs);

            const line = document.createElementNS(svgNS, "line");

            line.setAttribute("x1", startX);
            line.setAttribute("y1", startY);
            line.setAttribute("x2", endX);
            line.setAttribute("y2", endY);
            line.setAttribute("stroke", arrowColor);
            line.setAttribute("stroke-opacity", "0.9");
            line.setAttribute("stroke-width", "0.16");
            line.setAttribute("stroke-linecap", "round");
            line.setAttribute("marker-end", "url(#review-arrow-head)");

            svg.appendChild(line);

            boardEl.appendChild(svg);

        }

        // Shows the arrow for a reviewed move's entry from currentAnalysis
        // (perMove[i]) if that move wasn't the engine's top choice, or
        // clears any existing arrow otherwise (including for Book moves,
        // which — like chess.com — aren't held to the strict best-move
        // bar). No-op quietly if the UCI best move is missing.
        function updateBestMoveArrowForEntry(entry) {

            if (
                !entry ||
                entry.matchesBest ||
                entry.classification === "book" ||
                !entry.bestMoveUCI ||
                entry.bestMoveUCI.length < 4
            ) {

                clearBoardBestMoveArrow();

                return;

            }

            const fromSquare = entry.bestMoveUCI.slice(0, 2);
            const toSquare = entry.bestMoveUCI.slice(2, 4);

            showBoardBestMoveArrow(fromSquare, toSquare);

        }

        /* ========================================
           RESET GAME
        ======================================== */

        function resetGame() {

            game = new Chess();

            selected = null;

            clearUI();

            board.position('start');

            if (clockConfigEnabled) {

                startClock(clockConfigBaseMinutes, clockConfigIncrementSeconds);

            } else {

                disableClock();

            }

            updateState();

        }

        /* ========================================
           EXPORT PGN
        ======================================== */

        function exportGame() {

            const pgn = game.pgn();

            navigator.clipboard.writeText(pgn);

            alert("PGN copied!\n\n" + pgn);

        }
        function toggleMoreMenu() {

    const menu = document.getElementById("more-menu");

    const opening = menu.style.display !== "block";

    if (opening) {

        // Same dropdown, different actions depending on whether
        // we're in a live two-player game or reviewing an
        // imported PGN.
        const showAnalysisItems = currentMode === "analysis";

        document.querySelectorAll(
            "#more-menu .menu-item-twoplayer"
        ).forEach(function (btn) {
            btn.style.display = showAnalysisItems ? "none" : "block";
        });

        document.querySelectorAll(
            "#more-menu .menu-item-analysis"
        ).forEach(function (btn) {
            btn.style.display = showAnalysisItems ? "block" : "none";
        });

        menu.style.display = "block";

    } else {

        menu.style.display = "none";

    }

}

function closeMoreMenu() {

    document.getElementById(
        "more-menu"
    ).style.display = "none";

}
function undoMove() {

    if (game.history().length === 0) {
        return;
    }

    game.undo();

    selected = null;

    clearUI();

    board.position(game.fen());

    if (clockEnabled && !game.game_over()) {

        beginTurnClock(game.turn());

    }

    updateState();

}

function previousMove() {

    if (currentMoveIndex <= 0) return;

    currentMoveIndex--;

    game.reset();

    for (let i = 0; i < currentMoveIndex; i++) {

        game.move(moveHistory[i]);

    }

    board.position(game.fen());

    updateOpeningDisplay();

}

function nextMove() {

    if (currentMoveIndex >= moveHistory.length) return;

    game.move(
        moveHistory[currentMoveIndex]
    );

    currentMoveIndex++;

    board.position(game.fen());

    updateOpeningDisplay();

}

function flipBoard() {

    const orientation =
        board.orientation();

    if (orientation === "white") {

        board.orientation("black");

    } else {

        board.orientation("white");

    }

    renderClocks();

}
function openSettings() {

    document.getElementById(
        "settings-rating"
    ).value = playerRating;

    document.getElementById(
        "settings-screen"
    ).style.display = "flex";

}

function closeSettingsScreen() {

    document.getElementById(
        "settings-screen"
    ).style.display = "none";

}

function saveSettings() {

    const raw = parseInt(
        document.getElementById("settings-rating").value,
        10
    );

    if (!isNaN(raw)) {

        playerRating = Math.min(3000, Math.max(100, raw));

        localStorage.setItem("playerRating", playerRating);

    }

    closeSettingsScreen();

}
function resignGame() {

    if (!game.game_over()) {

        showGameResult(
            game.turn() === "w"
                ? "Black Wins"
                : "White Wins",

            game.turn() === "w"
                ? "White resigned."
                : "Black resigned.",

            game.turn() === "w"
                ? "black"
                : "white"
        );

    }

}

        /* ========================================
           IMPORT PGN
        ======================================== */

        function importGame() {

    document.getElementById(
        "pgn-screen"
    ).style.display = "flex";

}

     function closePGNScreen() {

    document.getElementById("pgn-screen").style.display = "none";

    // "Load New PGN" can open this screen from two different
    // places: fresh from Home (openAnalysis(), which hides
    // game-screen first) or from an already-active game via the
    // more-menu (importGame(), which leaves game-screen showing
    // underneath this overlay). Only fall back to Home if there
    // isn't already a game screen waiting behind this one.
    const gameScreen = document.getElementById("game-screen");

    if (gameScreen.style.display === "none") {

        document.getElementById("home-screen").style.display = "flex";

    }

}

     function loadPGN() {

    const pgn = document.getElementById("pgn-input").value;

    if (!pgn.trim()) return;

    // Validate on a scratch board first. chess.js's load_pgn()
    // returns false on a bad PGN rather than throwing, and it
    // mutates whatever board it's called on even when it fails
    // partway through — so validating directly against the live
    // `game` would leave an in-progress game corrupted by a typo,
    // with no alert, if we didn't check the return value.
    const parsedGame = new Chess();

    if (!parsedGame.load_pgn(pgn)) {

        alert("Invalid PGN!");

        return;

    }

    // This can replace an in-progress two-player game (via the
    // more-menu's "Load New PGN"), so make sure nothing from that
    // old game keeps running underneath the imported one.
    disableClock();

    currentMode = "analysis";

    game = parsedGame;

    moveHistory = game.history();
    currentMoveIndex = moveHistory.length;

    board.position(game.fen());

    selected = null;
    clearUI();
    updateState();

    // Make the imported game reviewable, whether it ended in
    // checkmate/draw or was loaded mid-game.
    finishedGamePGN = game.pgn();

    if (game.in_checkmate()) {

        gameResult = game.turn() === "w" ? "Black" : "White";

    } else if (game.in_draw()) {

        gameResult = "draw";

    } else {

        gameResult = "";

    }

    document.getElementById("pgn-screen").style.display = "none";

    document.getElementById("game-screen").style.display = "block";

    document.getElementById("analysis-bar").style.display = "flex";

    document.getElementById("two-player-bar").style.display = "none";
    document.getElementById(
    "analysis-controls"
).style.display = "flex";
}

        /* ========================================
           IMPORT FROM CHESS.COM
           ----------------------------------------
           Uses Chess.com's official public API
           (api.chess.com/pub/...), which is free,
           requires no key, and is CORS-friendly for
           direct browser use. It only exposes monthly
           archives per username — there's no official
           "single game by ID" endpoint — so this fetches
           a whole month's games and lets you pick one,
           rather than accepting a pasted game URL.
        ======================================== */

        const CHESSCOM_DRAW_RESULTS = [
            "agreed", "repetition", "stalemate",
            "insufficient", "50move", "timevsinsufficient"
        ];

        function chessComResultLabel(resultCode) {

            if (resultCode === "win") return "Win";

            if (CHESSCOM_DRAW_RESULTS.indexOf(resultCode) !== -1) {
                return "Draw";
            }

            return "Loss";

        }

        function openChessComImport() {

            document.getElementById("pgn-screen").style.display = "none";
            document.getElementById("chesscom-screen").style.display = "flex";

            const usernameInput = document.getElementById("chesscom-username");
            const monthInput = document.getElementById("chesscom-month");

            // Convenience only — never required. Prefills the last
            // username you searched with, so you don't retype it every
            // time, but it stays a normal editable text field so you
            // can just as easily look up someone else's games.
            if (!usernameInput.value) {

                const savedUsername = localStorage.getItem(
                    "chesscomLastUsername"
                );

                if (savedUsername) usernameInput.value = savedUsername;

            }

            if (!monthInput.value) {

                // Default to last calendar month, per your own request
                // ("all games I played last month") — always editable
                // to look at any other month instead.
                const now = new Date();

                let year = now.getFullYear();
                let month = now.getMonth(); // 0-11, so this is already "last month" as a 0-based index

                if (month === 0) {
                    month = 12;
                    year -= 1;
                }

                monthInput.value = year + "-" + String(month).padStart(2, "0");

            }

        }

        function closeChessComScreen() {

            document.getElementById("chesscom-screen").style.display = "none";
            document.getElementById("pgn-screen").style.display = "flex";

        }

        function setChessComStatus(message, isError) {

            const el = document.getElementById("chesscom-status");

            el.textContent = message || "";

            el.classList.toggle("chesscom-error", !!isError);

        }

        function fetchChessComGames() {

            const usernameRaw = document.getElementById(
                "chesscom-username"
            ).value.trim();

            const monthValue = document.getElementById(
                "chesscom-month"
            ).value;

            document.getElementById("chesscom-game-list").innerHTML = "";

            if (!usernameRaw) {
                setChessComStatus("Enter a Chess.com username first.", true);
                return;
            }

            if (!monthValue) {
                setChessComStatus("Pick a month first.", true);
                return;
            }

            const username = usernameRaw.toLowerCase();
            const [year, month] = monthValue.split("-");

            const fetchBtn = document.getElementById("chesscom-fetch-btn");

            fetchBtn.disabled = true;
            fetchBtn.textContent = "Searching...";

            setChessComStatus("Searching...", false);

            fetch(
                "https://api.chess.com/pub/player/" + username +
                "/games/" + year + "/" + month
            )
                .then(function (response) {

                    if (response.status === 404) {
                        throw new Error(
                            "No Chess.com account found for \"" +
                            usernameRaw + "\"."
                        );
                    }

                    if (!response.ok) {
                        throw new Error(
                            "Chess.com returned an error (" +
                            response.status + "). Try again."
                        );
                    }

                    return response.json();

                })
                .then(function (data) {

                    const games = (data && data.games) || [];

                    const playable = games.filter(function (g) {
                        return !!g.pgn;
                    });

                    if (playable.length === 0) {

                        setChessComStatus(
                            "No games found for " + usernameRaw +
                            " in " + monthValue + ".",
                            false
                        );

                        return;

                    }

                    localStorage.setItem(
                        "chesscomLastUsername",
                        usernameRaw
                    );

                    setChessComStatus(
                        playable.length + " game" +
                        (playable.length === 1 ? "" : "s") + " found — tap one to load it.",
                        false
                    );

                    renderChessComGameList(playable, username);

                })
                .catch(function (err) {

                    // Covers network failures too (offline, or Chess.com
                    // unreachable), not just the errors thrown above.
                    setChessComStatus(
                        err && err.message ?
                            err.message :
                            "Couldn't reach Chess.com. Check your connection and try again.",
                        true
                    );

                })
                .finally(function () {

                    fetchBtn.disabled = false;
                    fetchBtn.textContent = "Find Games";

                });

        }

        function renderChessComGameList(games, username) {

            const list = document.getElementById("chesscom-game-list");

            list.innerHTML = "";

            // Most recent first.
            games.slice().reverse().forEach(function (g) {

                const isWhite = (
                    g.white.username || ""
                ).toLowerCase() === username;

                const me = isWhite ? g.white : g.black;
                const opponent = isWhite ? g.black : g.white;

                const resultLabel = chessComResultLabel(me.result);

                const resultClass =
                    resultLabel === "Win" ? "chesscom-result-win" :
                    resultLabel === "Draw" ? "chesscom-result-draw" :
                    "chesscom-result-loss";

                const dateStr = g.end_time ?
                    new Date(g.end_time * 1000).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" }
                    ) :
                    "";

                const timeClass = g.time_class ?
                    g.time_class.charAt(0).toUpperCase() +
                    g.time_class.slice(1) :
                    "";

                const row = document.createElement("div");

                row.className = "chesscom-game-row";

                row.innerHTML =
                    '<div>' +
                        '<div class="chesscom-game-opponent">' +
                            (isWhite ? "\u2659" : "\u265F") + " vs " +
                            (opponent.username || "Unknown") +
                        '</div>' +
                        '<div class="chesscom-game-meta">' +
                            timeClass + " \u00B7 " + dateStr +
                        '</div>' +
                    '</div>' +
                    '<div class="chesscom-game-result ' + resultClass + '">' +
                        resultLabel +
                    '</div>';

                row.addEventListener("click", function () {

                    document.getElementById("pgn-input").value = g.pgn;

                    document.getElementById(
                        "chesscom-screen"
                    ).style.display = "none";

                    loadPGN();

                });

                list.appendChild(row);

            });

        }

        /* ========================================
           APP STARTUP
        ======================================== */

        window.onload = function () {

            initBoard();

        };
