const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSponsorBudget, budgetSettings, SponsorPaused, LAMPORTS_PER_SOL: SOL } = require('../relay/sponsor_budget');

const DAY = 24 * 60 * 60 * 1000;

function wallet(startSol) {
    const w = { balance: Math.round(startSol * SOL), time: Date.UTC(2026, 10, 6, 9), reads: 0 };
    w.spend = sol => { w.balance -= Math.round(sol * SOL); };
    w.getBalance = async () => { w.reads += 1; return w.balance; };
    return w;
}

function budget(w, overrides = {}) {
    return createSponsorBudget({
        getBalance: w.getBalance,
        dailyLamports: 0.5 * SOL,
        floorLamports: 0.2 * SOL,
        reserveLamports: 0.01 * SOL,
        now: () => w.time,
        ...overrides,
    });
}

test('settings default to a 0.5 SOL daily budget and a 0.2 SOL floor, and reject malformed values', () => {
    assert.deepEqual(budgetSettings({}), { dailyLamports: 0.5 * SOL, floorLamports: 0.2 * SOL, reserveLamports: 0.01 * SOL });
    assert.equal(budgetSettings({ OBLIVIA_SPONSOR_DAILY_SOL: '2', OBLIVIA_SPONSOR_MIN_SOL: '0.05' }).dailyLamports, 2 * SOL);
    assert.equal(budgetSettings({ OBLIVIA_SPONSOR_MIN_SOL: '0.05' }).floorLamports, 0.05 * SOL);
    for (const bad of ['-1', 'abc', '1e3', '0.0000000001']) {
        assert.throws(() => budgetSettings({ OBLIVIA_SPONSOR_DAILY_SOL: bad }), /non-negative SOL amount/);
    }
});

test('sponsoring stops before the wallet drops below the floor', async () => {
    const w = wallet(0.25);
    const b = budget(w);
    const release = await b.acquire();
    w.spend(0.045); // 0.205 left: one more request could take it under 0.2
    release();
    await assert.rejects(b.acquire(), error => error instanceof SponsorPaused && /low on funds/.test(error.message));
});

test('the daily budget caps total spend, then resets the next UTC day', async () => {
    const w = wallet(10);
    const b = budget(w);
    let served = 0;
    for (;;) {
        let release;
        try { release = await b.acquire(); } catch (error) {
            assert.ok(error instanceof SponsorPaused);
            assert.match(error.message, /budget is used up/);
            break;
        }
        w.spend(0.02);
        release();
        served += 1;
    }
    assert.ok(10 * SOL - w.balance <= 0.5 * SOL, 'spent no more than the daily budget');
    assert.equal(served, 25);

    w.time += DAY;
    const release = await b.acquire();
    release();
});

test('a burst of concurrent requests cannot overshoot the budget', async () => {
    const w = wallet(10);
    const b = budget(w, { dailyLamports: 0.05 * SOL });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => b.acquire()));
    const admitted = results.filter(r => r.status === 'fulfilled');
    assert.equal(admitted.length, 5, 'only as many as the reserved estimates fit in the budget');
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason instanceof SponsorPaused));
    admitted.forEach(r => r.value());
});

test('a top-up does not erase what was already spent today', async () => {
    const w = wallet(1);
    const b = budget(w);
    const release = await b.acquire();
    w.spend(0.495); // one more request would pass the 0.5 budget
    await release(); // the relay records the balance the request left behind
    w.balance += 5 * SOL;
    await assert.rejects(b.acquire(), /budget is used up/);
});

test('releasing twice does not free a second reservation', async () => {
    const w = wallet(10);
    const b = budget(w);
    const release = await b.acquire();
    release();
    release();
    assert.equal(b.state.inFlight, 0);
});

test('an unreadable balance fails closed and does not jam later checks', async () => {
    const w = wallet(10);
    let fail = true;
    const b = budget(w, { getBalance: async () => { if (fail) throw new Error('rpc down'); return w.balance; } });
    await assert.rejects(b.acquire(), /rpc down/);
    fail = false;
    (await b.acquire())();
});

test('after a restart the floor still holds, because it is read from the chain', async () => {
    const w = wallet(0.205);
    await assert.rejects(budget(w).acquire(), /low on funds/);
});

test('every sponsored relay route runs the budget check; read-only routes do not', () => {
    const source = fs.readFileSync(path.join(__dirname, '../relay/server.js'), 'utf8');
    for (const route of ['/sign', '/multisig/create', '/multisig/sign']) {
        assert.ok(source.includes(`app.post('${route}', limitSponsoredRequest, budgetSponsoredRequest, async`), route);
    }
    assert.ok(!/app\.get\([^)]*budgetSponsoredRequest/.test(source));
});
