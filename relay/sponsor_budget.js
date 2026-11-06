// Bounds what the sponsor wallet can spend, so abuse of the public relay costs
// at most a known amount. Two limits, both read from the wallet's on-chain
// balance rather than from request counts:
//
//   - a balance floor: below it the relay stops sponsoring. This holds across
//     restarts because it is checked against the chain on every request.
//   - a daily budget: the most the wallet may spend per UTC day. Spending is
//     the drop in balance since the day's first request; top-ups add to the
//     baseline so they do not erase what was already spent.
//
// Each request in flight also reserves an estimated cost, so a burst of
// concurrent requests cannot all pass the check before any of them settles.

const LAMPORTS_PER_SOL = 1_000_000_000;

const DEFAULTS = {
    dailySol: 0.5,
    floorSol: 0.2,
    reserveSol: 0.01,
};

class SponsorPaused extends Error {
    constructor(message) {
        super(message);
        this.status = 503;
    }
}

function solSetting(value, fallback, name) {
    if (value === undefined || value === '') return Math.round(fallback * LAMPORTS_PER_SOL);
    if (typeof value !== 'string' || !/^\d+(\.\d{1,9})?$/.test(value.trim())) {
        throw new Error(`${name} must be a non-negative SOL amount`);
    }
    return Math.round(Number(value.trim()) * LAMPORTS_PER_SOL);
}

function budgetSettings(env = {}) {
    return {
        dailyLamports: solSetting(env.OBLIVIA_SPONSOR_DAILY_SOL, DEFAULTS.dailySol, 'OBLIVIA_SPONSOR_DAILY_SOL'),
        floorLamports: solSetting(env.OBLIVIA_SPONSOR_MIN_SOL, DEFAULTS.floorSol, 'OBLIVIA_SPONSOR_MIN_SOL'),
        reserveLamports: Math.round(DEFAULTS.reserveSol * LAMPORTS_PER_SOL),
    };
}

function utcDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

function createSponsorBudget({ getBalance, dailyLamports, floorLamports, reserveLamports, now = Date.now }) {
    const state = { day: null, baseline: 0, lastBalance: 0, inFlight: 0 };
    let queue = Promise.resolve();

    // Apply a balance reading. A rise since the last reading is a top-up (or a
    // refund), so it moves the baseline up instead of cancelling earlier spend.
    function observe(balance) {
        const day = utcDay(now());
        if (day !== state.day) {
            state.day = day;
            state.baseline = balance;
        } else if (balance > state.lastBalance) {
            state.baseline += balance - state.lastBalance;
        }
        state.lastBalance = balance;
    }

    async function check() {
        const balance = await getBalance();
        observe(balance);

        const reserved = state.inFlight * reserveLamports;
        const spent = Math.max(0, state.baseline - balance);
        if (balance - reserved - reserveLamports < floorLamports) {
            throw new SponsorPaused('Sponsored signing is paused: the relay wallet is low on funds.');
        }
        if (spent + reserved + reserveLamports > dailyLamports) {
            throw new SponsorPaused("Sponsored signing is paused: today's budget is used up. Try again tomorrow (UTC).");
        }
        state.inFlight += 1;
        let released = false;
        // When a request finishes, record the balance it left behind, so a
        // later top-up is measured from there and cannot hide this spend.
        return () => {
            if (released) return queue;
            released = true;
            state.inFlight -= 1;
            return enqueue(async () => { observe(await getBalance()); }).catch(() => undefined);
        };
    }

    // Balance readings are applied one at a time, in order.
    function enqueue(task) {
        const result = queue.then(task);
        queue = result.then(() => undefined, () => undefined);
        return result;
    }

    function acquire() {
        return enqueue(check);
    }

    return { acquire, state };
}

module.exports = { createSponsorBudget, budgetSettings, SponsorPaused, LAMPORTS_PER_SOL };
