use serde_json::Value;
use std::{env, fs, path::PathBuf};

fn be(value: &Value) -> String {
    let digits = value
        .as_str()
        .unwrap()
        .bytes()
        .map(|b| b - b'0')
        .collect::<Vec<_>>();
    let mut bytes = [0u8; 32];
    let mut digits = digits;
    for byte in bytes.iter_mut().rev() {
        let mut quotient = Vec::new();
        let mut remainder = 0u16;
        for digit in digits {
            let n = remainder * 10 + digit as u16;
            if !quotient.is_empty() || n / 256 != 0 {
                quotient.push((n / 256) as u8);
            }
            remainder = n % 256;
        }
        *byte = remainder as u8;
        digits = quotient;
    }
    bytes
        .iter()
        .map(|b| format!("0x{b:02x}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let path = manifest.join("../../../zk_groth16/verification_key.json");
    println!("cargo:rerun-if-changed={}", path.display());
    let vk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(vk["nPublic"], 4, "Oblivia requires four public signals");
    let g1 = |point: &Value| format!("[{}, {}]", be(&point[0]), be(&point[1]));
    let g2 = |point: &Value| {
        format!(
            "[{}, {}, {}, {}]",
            be(&point[0][1]),
            be(&point[0][0]),
            be(&point[1][1]),
            be(&point[1][0])
        )
    };
    let ic = vk["IC"]
        .as_array()
        .unwrap()
        .iter()
        .map(g1)
        .collect::<Vec<_>>()
        .join(", ");
    let source = format!(
        "pub const VK_ALPHA_G1: [u8; 64] = {};\npub const VK_BETA_G2: [u8; 128] = {};\npub const VK_GAMMA_G2: [u8; 128] = {};\npub const VK_DELTA_G2: [u8; 128] = {};\npub const IC: [[u8; 64]; 5] = [{}];\n",
        g1(&vk["vk_alpha_1"]), g2(&vk["vk_beta_2"]), g2(&vk["vk_gamma_2"]), g2(&vk["vk_delta_2"]), ic
    );
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("vk_generated.rs"),
        source,
    )
    .unwrap();
}
