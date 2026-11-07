//! 문서 통합 뷰어 — 윈도우판.
//! 화면은 안드로이드 앱과 같은 웹앱(android/app/src/main/assets/public)을 그대로 씀.
//! 이 파일은 웹앱이 PC 에서 필요로 하는 것만 제공한다:
//!  - 탐색기에서 더블클릭/연결 프로그램으로 연 파일 전달 (실행 인자, 이미 켜져 있으면 single-instance 로 전달)
//!  - "다른 이름으로 저장" 창을 띄워 내보낸 파일 저장
//!  - 링크·메일 주소를 기본 브라우저/메일 프로그램으로 열기
//! 네트워크 요청은 하지 않는다 (업데이트 확인·통계 수집 없음).

use std::path::PathBuf;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MAX_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Serialize, Clone)]
struct OpenedFile {
    name: String,
    data: String, // base64
}

/// 앱 시작 시 인자로 받은 파일 (웹앱이 준비되면 가져감)
struct Pending(Mutex<Vec<OpenedFile>>);

fn read_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<OpenedFile> {
    args.into_iter()
        .skip(1) // 첫 번째는 실행 파일 경로
        .filter_map(|a| {
            let p = PathBuf::from(&a);
            if !p.is_file() {
                return None;
            }
            if std::fs::metadata(&p).ok()?.len() > MAX_BYTES {
                return None;
            }
            let bytes = std::fs::read(&p).ok()?;
            Some(OpenedFile {
                name: p.file_name()?.to_string_lossy().into_owned(),
                data: STANDARD.encode(bytes),
            })
        })
        .collect()
}

#[tauri::command]
fn take_opened_files(state: State<Pending>) -> Vec<OpenedFile> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// 저장 위치를 고르는 창을 띄우고 파일을 씀. 취소하면 None.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, data: String) -> Result<Option<String>, String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let chosen = app.dialog().file().set_file_name(&name).blocking_save_file();
    match chosen {
        None => Ok(None),
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
    }
}

/// http/https/mailto/tel 만 기본 프로그램으로 엶
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    let allowed = ["http://", "https://", "mailto:", "tel:"].iter().any(|p| lower.starts_with(p));
    if !allowed {
        return Err("blocked address".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        // 이미 켜져 있을 때 다른 파일을 더블클릭하면 새 창 대신 기존 창으로 전달
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            for f in read_paths(args) {
                let _ = app.emit("file-opened", f);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Pending(Mutex::new(read_paths(std::env::args()))))
        .invoke_handler(tauri::generate_handler![take_opened_files, save_file, open_external])
        .run(tauri::generate_context!())
        .expect("error while running Document Viewer");
}
