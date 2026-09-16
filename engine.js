/* ========================================
   STOCKFISH ENGINE WRAPPER
   ----------------------------------------
   Loads stockfish-19-lite-single.js into a small POOL of Web Workers
   (rather than a single one) and exposes:

       evaluatePosition(fen, depth)

   which returns a Promise that resolves to:

       { cp, mate, bestMove }

   - cp / mate are from the perspective of the
     side to move in that FEN (standard UCI).
   - bestMove is the engine's top move in UCI
     form, e.g. "e2e4" or "e7e8q".

   Why a pool: each worker only ever runs one single-threaded search
   at a time, so a single worker leaves every other CPU core on the
   device completely idle while analyzing a game move-by-move. Most
   phones and laptops have several cores; running that many
   independent engine instances in parallel — each analyzing a
   different position — cuts full-game analysis time roughly in
   proportion to the pool size, with no change to per-position search
   depth or strength. This is a different kind of parallelism than a
   multi-threaded engine build (which speeds up a single search using
   SharedArrayBuffer and needs special cross-origin server headers);
   this instead runs several ordinary, independent single-threaded
   searches side by side, which works everywhere with no server
   configuration at all.

   Calls are queued and handed to whichever worker is free next, so
   callers don't need to know or care how big the pool is.
======================================== */

// Leave one core free for the UI thread; use at most 4 workers (each
// one holds its own copy of the engine + hash tables in memory, so
// going much higher trades a lot of memory for diminishing returns).
const SF_POOL_SIZE = Math.max(
    1,
    Math.min(
        (navigator.hardwareConcurrency || 3) - 1,
        4
    )
);

const sfPool = []; // { worker, ready, busy }
const sfJobQueue = []; // { fen, depth, resolve, reject }

function createSfWorker() {

    const worker = new Worker('stockfish-19-lite-single.js');

    const slot = { worker: worker, ready: null, busy: false };

    slot.ready = new Promise((resolve, reject) => {

        let sawUciOk = false;

        function handleInit(e) {

            const line = e.data;

            if (typeof line !== 'string') return;

            if (line === 'uciok') {

                sawUciOk = true;

                // Ask for the top 2 candidate moves, not just 1.
                // Comparing the best move to the second-best move is
                // how we spot "only moves" (Great) and check whether a
                // sacrifice is actually sound (Brilliant).
                worker.postMessage('setoption name MultiPV value 2');

                worker.postMessage('isready');

                return;

            }

            if (line === 'readyok' && sawUciOk) {

                worker.removeEventListener('message', handleInit);

                resolve();

            }

        }

        worker.addEventListener('message', handleInit);

        worker.onerror = function (err) {
            reject(err);
        };

        worker.postMessage('uci');

    });

    return slot;

}

function initEnginePool() {

    if (sfPool.length > 0) return;

    for (let i = 0; i < SF_POOL_SIZE; i++) {
        sfPool.push(createSfWorker());
    }

}

// Hands the next queued job to `slot` and, once it resolves, tries to
// pull another job for the same worker — this is what keeps every
// worker in the pool continuously busy until the queue drains.
function runJobOnSlot(slot, job) {

    slot.busy = true;

    slot.ready
        .then(function () {
            return runEvaluationOnWorker(
                slot.worker,
                job.fen,
                job.depth,
                job.movetimeMs
            );
        })
        .then(function (result) {

            slot.busy = false;

            job.resolve(result);

            pumpQueue();

        }, function (err) {

            slot.busy = false;

            job.reject(err);

            pumpQueue();

        });

}

function pumpQueue() {

    if (sfJobQueue.length === 0) return;

    const freeSlot = sfPool.find(function (s) { return !s.busy; });

    if (!freeSlot) return;

    const job = sfJobQueue.shift();

    runJobOnSlot(freeSlot, job);

    // In case more than one slot is free, keep assigning.
    if (sfJobQueue.length > 0) pumpQueue();

}

// depth: target search depth (a ceiling on how deep to go, not a
//        guarantee — see movetimeMs below).
// movetimeMs: optional time cap in milliseconds. When given, the
//        engine is told to stop at whichever limit — depth or time —
//        is reached first (standard UCI "go depth X movetime Y"
//        behavior). This is what makes a high target depth safe to
//        use: quiet/simple positions will reach it quickly, and
//        sharp/complex ones get cut off at the time cap instead of
//        running indefinitely, so one hard position can't stall the
//        whole game's analysis.
function evaluatePosition(fen, depth, movetimeMs) {

    depth = depth || 12;

    initEnginePool();

    return new Promise(function (resolve, reject) {

        sfJobQueue.push({
            fen: fen,
            depth: depth,
            movetimeMs: movetimeMs || null,
            resolve: resolve,
            reject: reject
        });

        pumpQueue();

    });

}

function runEvaluationOnWorker(worker, fen, depth, movetimeMs) {

    return new Promise((resolve) => {

        // Keyed by MultiPV line number (1 = best, 2 = second-best).
        const lines = {};

        // The deepest "depth N" actually reported before bestmove —
        // this is what the movetime cap may have cut short of the
        // requested target depth, so it's tracked separately and
        // returned to the caller instead of just assuming the target
        // depth was reached.
        let deepestDepthSeen = null;

        function handleMessage(e) {

            const line = e.data;

            if (typeof line !== 'string') return;

            if (line.indexOf('info') === 0 && line.indexOf(' pv ') !== -1) {

                const depthMatch = line.match(/(?:^|\s)depth (\d+)/);

                if (depthMatch) {

                    const reportedDepth = parseInt(depthMatch[1], 10);

                    if (deepestDepthSeen === null || reportedDepth > deepestDepthSeen) {
                        deepestDepthSeen = reportedDepth;
                    }

                }

                const multipvMatch = line.match(/multipv (\d+)/);
                const pvIndex = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;

                const cpMatch = line.match(/score cp (-?\d+)/);
                const mateMatch = line.match(/score mate (-?\d+)/);
                const pvMatch = line.match(/ pv (.+)$/);

                const entry = {
                    cp: null,
                    mate: null,
                    move: pvMatch ? pvMatch[1].trim().split(' ')[0] : null
                };

                if (mateMatch) {
                    entry.mate = parseInt(mateMatch[1], 10);
                } else if (cpMatch) {
                    entry.cp = parseInt(cpMatch[1], 10);
                }

                lines[pvIndex] = entry;

            }

            if (line.indexOf('bestmove') === 0) {

                worker.removeEventListener('message', handleMessage);

                const parts = line.split(' ');

                const best = lines[1] || {};
                const second = lines[2] || null;

                resolve({
                    cp: best.cp,
                    mate: best.mate,
                    bestMove: parts[1] || best.move || null,
                    secondCp: second ? second.cp : null,
                    secondMate: second ? second.mate : null,
                    secondMove: second ? second.move : null,
                    depthReached: deepestDepthSeen,
                    depthRequested: depth,
                    timeCapped: deepestDepthSeen !== null && deepestDepthSeen < depth
                });

            }

        }

        worker.addEventListener('message', handleMessage);

        worker.postMessage('position fen ' + fen);

        worker.postMessage(
            'go depth ' + depth +
            (movetimeMs ? ' movetime ' + movetimeMs : '')
        );

    });

}
