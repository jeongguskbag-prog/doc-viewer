// 콘솔 창 없이 실행 (릴리스)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    doc_viewer_lib::run()
}
