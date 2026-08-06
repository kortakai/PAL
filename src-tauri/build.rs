use std::{env, fs, path::PathBuf};

fn replace_once(source: &mut String, old: &str, new: &str) {
    if !source.contains(old) {
        panic!("Expected launcher source fragment was not found: {old}");
    }
    *source = source.replacen(old, new, 1);
}

fn main() {
    println!("cargo:rerun-if-changed=src/lib.rs");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let source_path = manifest_dir.join("src/lib.rs");
    let mut source = fs::read_to_string(&source_path).expect("Unable to read src/lib.rs");

    source = source.replace(
        "include_str!(\"../resources/reforged-addons/AethroGlobal/AethroGlobal.lua\")",
        "include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/resources/reforged-addons/AethroGlobal/AethroGlobal.lua\"))",
    );
    source = source.replace(
        "include_str!(\"../resources/reforged-addons/AethroGlobal/AethroGlobal.toc\")",
        "include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/resources/reforged-addons/AethroGlobal/AethroGlobal.toc\"))",
    );
    source = source.replace(
        "include_str!(\"../../manifests/shadows-stable.json\")",
        "include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/../manifests/shadows-stable.json\"))",
    );

    replace_once(
        &mut source,
        "const SHADOWS_DOWNLOAD_PATH_PREFIX: &str = \"/launcher/shadows/stable/files/\";\n",
        "const SHADOWS_DOWNLOAD_PATH_PREFIX: &str = \"/launcher/shadows/stable/files/\";\nconst REFORGED_DOWNLOAD_PATH_PREFIX: &str = \"/public_html/downloads/\";\n",
    );

    let addon_function = r#"fn reforged_addon_files() -> [(&'static str, &'static str); 2] {
    [
        (AETHRO_GLOBAL_LUA_RELATIVE_PATH, AETHRO_GLOBAL_LUA_CONTENT),
        (AETHRO_GLOBAL_TOC_RELATIVE_PATH, AETHRO_GLOBAL_TOC_CONTENT),
    ]
}
"#;

    let managed_function = r#"fn reforged_addon_files() -> [(&'static str, &'static str); 2] {
    [
        (AETHRO_GLOBAL_LUA_RELATIVE_PATH, AETHRO_GLOBAL_LUA_CONTENT),
        (AETHRO_GLOBAL_TOC_RELATIVE_PATH, AETHRO_GLOBAL_TOC_CONTENT),
    ]
}

fn reforged_managed_files() -> Vec<ShadowsManifestFile> {
    vec![
        ShadowsManifestFile {
            path: "Data/Patch-F.mpq".to_string(),
            url: Some("https://aethro.net/public_html/downloads/Patch-F.mpq".to_string()),
            sha256: "4fef7ed6a3b24c90235ae902ffc8e77dc476fbee073f749469f8fa8ce193feff".to_string(),
            size_bytes: Some(9_124_021),
        },
        ShadowsManifestFile {
            path: "Interface/AddOns/ReagentBankUI/Bindings.xml".to_string(),
            url: Some("https://aethro.net/public_html/downloads/ReagentBankUI/Bindings.xml".to_string()),
            sha256: "06898d4941d3822fb6809f13a7f27cbca8b5d98d73ee24156759e102103b0e0e".to_string(),
            size_bytes: Some(316),
        },
        ShadowsManifestFile {
            path: "Interface/AddOns/ReagentBankUI/ReagentBankUI_Share.lua".to_string(),
            url: Some("https://aethro.net/public_html/downloads/ReagentBankUI/ReagentBankUI_Share.lua".to_string()),
            sha256: "e76d169a19bd3386e74737e53fa51678a3db798523e641ce6ab4df84b0c2867b".to_string(),
            size_bytes: Some(17_404),
        },
        ShadowsManifestFile {
            path: "Interface/AddOns/ReagentBankUI/ReagentBankUI.lua".to_string(),
            url: Some("https://aethro.net/public_html/downloads/ReagentBankUI/ReagentBankUI.lua".to_string()),
            sha256: "78ab8195cd85425d9502bcda40e9ea29b03e547cdd4199b8420d598fd8f821de".to_string(),
            size_bytes: Some(253_213),
        },
        ShadowsManifestFile {
            path: "Interface/AddOns/ReagentBankUI/ReagentBankUI.toc".to_string(),
            url: Some("https://aethro.net/public_html/downloads/ReagentBankUI/ReagentBankUI.toc".to_string()),
            sha256: "cfb2601843ecceb322a50860b2d75cde222ac7f227bb15bf55074371376f1870".to_string(),
            size_bytes: Some(293),
        },
        ShadowsManifestFile {
            path: "Interface/AddOns/ReagentBankUI/ReagentBankUI.xml".to_string(),
            url: Some("https://aethro.net/public_html/downloads/ReagentBankUI/ReagentBankUI.xml".to_string()),
            sha256: "e97e9266920c233c728809f335ba5e281a16a67ef50ff7d9e645045ee730c614".to_string(),
            size_bytes: Some(6_194),
        },
    ]
}
"#;
    replace_once(&mut source, addon_function, managed_function);

    let check_tail = r#"    for (relative_path, contents) in reforged_addon_files() {
        files.push(check_reforged_addon_file(
            install_dir,
            relative_path,
            contents,
        )?);
    }

    let ok_files = files.iter().filter(|file| file.status == "ok").count();
"#;

    let check_tail_replacement = r#"    for (relative_path, contents) in reforged_addon_files() {
        files.push(check_reforged_addon_file(
            install_dir,
            relative_path,
            contents,
        )?);
    }

    let managed_files = reforged_managed_files();
    let managed_result = check_manifest_files(
        "Reforged",
        "reforged",
        "Aethro: Reforged",
        "client-assets",
        &managed_files,
        install_dir,
        None,
        "reforged-repair-progress",
    )?;
    files.extend(managed_result.files);

    let ok_files = files.iter().filter(|file| file.status == "ok").count();
"#;
    replace_once(&mut source, check_tail, check_tail_replacement);

    let start_marker = "#[tauri::command]\nasync fn check_reforged_install(";
    let end_marker = "#[tauri::command]\nfn detect_local_minecraft_profile()";
    let start = source.find(start_marker).expect("Unable to find Reforged check function");
    let end = source[start..]
        .find(end_marker)
        .map(|offset| start + offset)
        .expect("Unable to find end of Reforged repair functions");

    let replacement = r#"#[tauri::command]
async fn check_reforged_install(
    app_handle: tauri::AppHandle,
) -> Result<ModpackCheckResult, String> {
    let install_dir = required_reforged_install_dir(&app_handle)?;
    let total_files = 3 + reforged_managed_files().len();
    emit_reforged_progress(
        &app_handle,
        "checking",
        "Checking Reforged client setup",
        None,
        0,
        total_files,
        0,
        0,
    );
    let result = check_reforged_realm_list(&install_dir)?;
    emit_reforged_progress(
        &app_handle,
        if result.ready { "ready" } else { "needsUpdate" },
        if result.ready {
            "Reforged client setup is ready"
        } else {
            "Reforged client setup needs to be updated"
        },
        None,
        result.ok_files,
        result.total_files,
        0,
        0,
    );
    Ok(result)
}

#[tauri::command]
async fn repair_reforged_install(
    app_handle: tauri::AppHandle,
) -> Result<ModpackCheckResult, String> {
    let install_dir = required_reforged_install_dir(&app_handle)?;
    let managed_files = reforged_managed_files();
    let total_files = 3 + managed_files.len();

    emit_reforged_progress(
        &app_handle,
        "checking",
        "Checking Reforged client setup",
        None,
        0,
        total_files,
        0,
        0,
    );

    emit_reforged_progress(
        &app_handle,
        "installing",
        "Setting Reforged realm",
        Some(REFORGED_CONFIG_RELATIVE_PATH.to_string()),
        1,
        total_files,
        0,
        0,
    );
    update_reforged_realm_list(&install_dir)?;

    emit_reforged_progress(
        &app_handle,
        "installing",
        "Installing AethroGlobal addon",
        Some("Interface/AddOns/AethroGlobal".to_string()),
        2,
        total_files,
        0,
        0,
    );
    install_reforged_addons(&install_dir)?;

    let current = check_reforged_realm_list(&install_dir)?;
    let repair_files = managed_files
        .iter()
        .filter(|manifest_file| {
            current.files.iter().any(|status| {
                status.path == manifest_file.path
                    && (status.status == "missing" || status.status == "changed")
            })
        })
        .collect::<Vec<_>>();
    let total_download_bytes = repair_files
        .iter()
        .filter_map(|file| file.size_bytes)
        .sum::<u64>();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("Unable to create Reforged download client: {e}"))?;

    let mut downloaded_bytes = 0_u64;
    for (index, manifest_file) in repair_files.iter().enumerate() {
        emit_reforged_progress(
            &app_handle,
            "installing",
            format!("Installing {}", manifest_file.path),
            Some(manifest_file.path.clone()),
            index + 3,
            total_files,
            downloaded_bytes,
            total_download_bytes,
        );
        downloaded_bytes += download_manifest_file(
            &client,
            &install_dir,
            manifest_file,
            "Reforged",
            REFORGED_DOWNLOAD_PATH_PREFIX,
        )
        .await?;
    }

    let final_check = check_reforged_realm_list(&install_dir)?;
    emit_reforged_progress(
        &app_handle,
        if final_check.ready { "ready" } else { "needsUpdate" },
        if final_check.ready {
            "Reforged client setup is ready"
        } else {
            "Reforged client setup still needs to be updated"
        },
        None,
        final_check.ok_files,
        final_check.total_files,
        downloaded_bytes,
        total_download_bytes,
    );
    Ok(final_check)
}

"#;
    source.replace_range(start..end, replacement);

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out_dir.join("patched_lib.rs"), source).expect("Unable to write patched library");

    tauri_build::build()
}
