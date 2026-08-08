use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=../manifests/shadows-stable.json");
    println!("cargo:rerun-if-changed=../manifests/reforged-client.json");
    println!("cargo:rerun-if-changed=resources/reforged-addons/AethroGlobal/AethroGlobal.lua");
    println!("cargo:rerun-if-changed=resources/reforged-addons/AethroGlobal/AethroGlobal.toc");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let source_path = manifest_dir.join("src/lib.rs");
    let mut source = fs::read_to_string(&source_path)
        .expect("Unable to read src/lib.rs")
        .replace("\r\n", "\n")
        .replace('\r', "\n");

    for (old, new) in [
        (
            "include_str!(\"../resources/reforged-addons/AethroGlobal/AethroGlobal.lua\")",
            "include_str!(concat!(std::env!(\"CARGO_MANIFEST_DIR\"), \"/resources/reforged-addons/AethroGlobal/AethroGlobal.lua\"))",
        ),
        (
            "include_str!(\"../resources/reforged-addons/AethroGlobal/AethroGlobal.toc\")",
            "include_str!(concat!(std::env!(\"CARGO_MANIFEST_DIR\"), \"/resources/reforged-addons/AethroGlobal/AethroGlobal.toc\"))",
        ),
        (
            "include_str!(\"../../manifests/shadows-stable.json\")",
            "include_str!(concat!(std::env!(\"CARGO_MANIFEST_DIR\"), \"/../manifests/shadows-stable.json\"))",
        ),
        (
            "include_str!(\"../../manifests/reforged-client.json\")",
            "include_str!(concat!(std::env!(\"CARGO_MANIFEST_DIR\"), \"/../manifests/reforged-client.json\"))",
        ),
    ] {
        source = source.replace(old, new);
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out_dir.join("patched_lib.rs"), source).expect("Unable to write patched library");

    tauri_build::build()
}
