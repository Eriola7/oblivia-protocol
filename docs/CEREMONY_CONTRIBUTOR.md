# Contributing to the Oblivia trusted setup

Thank you for helping. Your contribution makes Oblivia's proofs impossible to forge, as long as at least one contributor, possibly you, really throws away their randomness. It takes about 10 minutes.

## What you need

- A computer with Node.js 22 or newer and git
- The file the coordinator sends you, named like `oblivia_0003.zkey`
- About 10 minutes, uninterrupted

## Steps

**1. Get the code and install the tools**

```bash
git clone https://github.com/Eriola7/oblivia-protocol.git
cd oblivia-protocol/zk_groth16
npm ci
```

**2. Put the file you received in the ceremony folder**

```bash
mkdir -p ceremony/out
mv ~/Downloads/oblivia_0003.zkey ceremony/out/
```

Use the real file name. It must be the only `.zkey` file in `ceremony/out/`.

**3. Contribute**

```bash
./ceremony/ceremony.sh contribute "Your Name or handle"
```

When asked, type a long string of random characters, as long as you like, and press Enter. It is mixed with your computer's own randomness. Don't reuse a password or anything you could remember.

The script prints a **contribution hash**, a block of hex, and writes the next file, for example `ceremony/out/oblivia_0004.zkey`.

**4. Send it back**

Send the coordinator:

- the new `.zkey` file
- the contribution hash, copied exactly

Also post the contribution hash somewhere public under your name, such as X, GitHub or a blog. That lets anyone confirm your contribution is in the final key.

**5. Destroy your randomness**

```bash
rm -rf ceremony/out
```

Close the terminal. Don't keep notes of what you typed.

## Why this matters

Anyone who knew *all* the contributors' random inputs could forge proofs. Each contribution adds secret randomness on top of the previous ones, so the final key is safe if even one person discarded theirs. You don't need to trust anyone else, only yourself.

## Questions

Ask the coordinator before you start. Once you've sent your file back, your part is done.
