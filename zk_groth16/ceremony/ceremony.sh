#!/usr/bin/env bash
# Oblivia Groth16 phase-2 trusted setup. See CEREMONY.md for the full process.
#
#   ceremony.sh init                     create the initial zkey from the public phase-1 file
#   ceremony.sh contribute "<name>"      add one contribution (entropy is prompted interactively)
#   ceremony.sh verify                   verify every contribution in the latest zkey
#   ceremony.sh beacon <hex> [iters]     apply the public random beacon (final step)
#   ceremony.sh export                   verify the final zkey and install it for the SDK, relay and program
#
# Environment:
#   PTAU     phase-1 Powers of Tau file (default: ceremony/powersOfTau28_hez_final_12.ptau)
#   ENTROPY  testing only: non-interactive contribution entropy. Never set this in a real ceremony.
set -euo pipefail

cd "$(dirname "$0")/.."
SNARKJS=(npx --no-install snarkjs)
PTAU="${PTAU:-ceremony/powersOfTau28_hez_final_12.ptau}"
OUT="ceremony/out"
R1CS="oblivia.r1cs"
mkdir -p "$OUT"

latest() {
    ls "$OUT"/oblivia_[0-9][0-9][0-9][0-9].zkey 2>/dev/null | sort | tail -n 1
}

next_name() {
    local current index
    current="$(latest)"
    index=$((10#$(basename "$current" .zkey | sed 's/oblivia_//') + 1))
    printf '%s/oblivia_%04d.zkey' "$OUT" "$index"
}

require_file() {
    [ -f "$1" ] || { echo "missing $1" >&2; exit 1; }
}

case "${1:-}" in
init)
    require_file "$PTAU"
    require_file "$R1CS"
    [ -z "$(latest)" ] || { echo "ceremony already initialized in $OUT" >&2; exit 1; }
    echo "Verifying phase-1 file $PTAU (compare its contribution hashes with the published list)..."
    "${SNARKJS[@]}" powersoftau verify "$PTAU" | tee "$OUT/phase1_verification.txt"
    "${SNARKJS[@]}" zkey new "$R1CS" "$PTAU" "$OUT/oblivia_0000.zkey"
    sha256sum "$R1CS" "$PTAU" "$OUT/oblivia_0000.zkey" | tee "$OUT/init.sha256"
    ;;
contribute)
    name="${2:?usage: ceremony.sh contribute \"<contributor name>\"}"
    current="$(latest)"
    [ -n "$current" ] || { echo "run init first" >&2; exit 1; }
    next="$(next_name)"
    if [ -n "${ENTROPY:-}" ]; then
        "${SNARKJS[@]}" zkey contribute "$current" "$next" --name="$name" -e="$ENTROPY" | tee "$next.log"
    else
        # snarkjs prompts for random text; it is combined with system randomness.
        "${SNARKJS[@]}" zkey contribute "$current" "$next" --name="$name" | tee "$next.log"
    fi
    sha256sum "$next" | tee -a "$OUT/contributions.sha256"
    echo "Publish $next and the contribution hash printed above. Delete any local entropy notes."
    ;;
verify)
    current="$(latest)"
    [ -n "$current" ] || { echo "nothing to verify" >&2; exit 1; }
    "${SNARKJS[@]}" zkey verify "$R1CS" "$PTAU" "$current" | tee "$OUT/verify_$(basename "$current" .zkey).txt"
    ;;
beacon)
    beacon="${2:?usage: ceremony.sh beacon <public random hex, e.g. a pre-announced drand round or block hash> [iterations]}"
    iterations="${3:-10}"
    [[ "$beacon" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "beacon must be 32 bytes of hex" >&2; exit 1; }
    current="$(latest)"
    "${SNARKJS[@]}" zkey beacon "$current" "$OUT/oblivia_final.zkey" "$beacon" "$iterations" -n="Final beacon" | tee "$OUT/beacon.log"
    ;;
export)
    final="$OUT/oblivia_final.zkey"
    require_file "$final"
    "${SNARKJS[@]}" zkey verify "$R1CS" "$PTAU" "$final" | tee "$OUT/final_verification.txt"
    grep -q "ZKey Ok!" "$OUT/final_verification.txt" || { echo "final zkey failed verification" >&2; exit 1; }
    "${SNARKJS[@]}" zkey export verificationkey "$final" verification_key.json
    # Keep the existing file names so the SDK, relay and program build.rs pick these up unchanged.
    cp "$final" oblivia_1.zkey
    cp "$final" ../sdk/lib/proving/oblivia_1.zkey
    cp verification_key.json ../sdk/lib/proving/verification_key.json
    sha256sum "$final" verification_key.json | tee "$OUT/final.sha256"
    echo "Next: rebuild and redeploy the program (build.rs embeds verification_key.json), then run npm test."
    ;;
*)
    sed -n '2,13p' "$0"
    exit 1
    ;;
esac
