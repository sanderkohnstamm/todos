#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod finished;

use std::path::PathBuf;
use serde::Serialize;
use chrono::Local;

fn todos_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".todos")
}

#[derive(Serialize)]
struct FilesPayload {
    todo: String,
    finished: String,
    todo_path: String,
    finished_path: String,
}

#[derive(Serialize)]
struct CompleteResult {
    todo: String,
    finished: String,
    message: String,
}

#[tauri::command]
fn load_files() -> FilesPayload {
    let dir = todos_dir();
    let _ = std::fs::create_dir_all(&dir);

    let todo = std::fs::read_to_string(dir.join("todo.md")).unwrap_or_default();
    let finished_raw = std::fs::read_to_string(dir.join("finished.md")).unwrap_or_default();

    let today = Local::now().date_naive();
    let finished = if !finished_raw.trim().is_empty() {
        finished::fill_empty_days(&finished_raw, today)
    } else {
        finished_raw
    };

    let todo_path = dir.join("todo.md").to_string_lossy().to_string();
    let finished_path = dir.join("finished.md").to_string_lossy().to_string();

    FilesPayload { todo, finished, todo_path, finished_path }
}

#[tauri::command]
fn save_files(todo: String, finished: String) -> String {
    let dir = todos_dir();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join("todo.md"), &todo);
    let _ = std::fs::write(dir.join("finished.md"), &finished);
    "Saved".to_string()
}

#[tauri::command]
fn complete_item(todo: String, finished: String, cursor_line: usize) -> CompleteResult {
    let today = Local::now().date_naive();
    match finished::complete_item(&todo, &finished, cursor_line, today) {
        Some((new_todo, new_finished)) => CompleteResult {
            todo: new_todo,
            finished: new_finished,
            message: "Completed!".to_string(),
        },
        None => CompleteResult {
            todo,
            finished,
            message: "Not a list item (- )".to_string(),
        },
    }
}

#[tauri::command]
fn recover_item(finished: String, todo: String, cursor_line: usize) -> CompleteResult {
    match finished::recover_item(&finished, &todo, cursor_line) {
        Some((new_finished, new_todo)) => CompleteResult {
            todo: new_todo,
            finished: new_finished,
            message: "Recovered to todo".to_string(),
        },
        None => CompleteResult {
            todo,
            finished,
            message: "Not a list item".to_string(),
        },
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_files,
            save_files,
            complete_item,
            recover_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
