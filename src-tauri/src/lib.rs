/// Setzt unter Windows das Attribut "versteckt". Der führende Punkt in `.v`
/// allein genügt dort nicht — der Explorer zeigt den Ordner trotzdem an.
/// Auf anderen Systemen reicht der Punkt, dort ist der Aufruf wirkungslos.
#[tauri::command]
fn verstecken(pfad: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;

        // FILE_ATTRIBUTE_HIDDEN. Nur diese eine Funktion wird gebraucht,
        // dafür lohnt keine zusätzliche Abhängigkeit.
        const HIDDEN: u32 = 0x2;
        extern "system" {
            fn SetFileAttributesW(name: *const u16, attrs: u32) -> i32;
        }

        let breit: Vec<u16> = std::ffi::OsStr::new(&pfad)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        if unsafe { SetFileAttributesW(breit.as_ptr(), HIDDEN) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    let _ = pfad;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![verstecken])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
