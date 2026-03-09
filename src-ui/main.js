import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { keymap } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';

const { invoke } = window.__TAURI__.tauri;

let todoView = null;
let finishedView = null;
let focusedPane = 'todo';
let statusTimeout = null;

function showMessage(msg) {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => { el.textContent = ''; }, 3000);
}

function updateFocus() {
  document.getElementById('todo-pane').classList.toggle('focused', focusedPane === 'todo');
  document.getElementById('finished-pane').classList.toggle('focused', focusedPane === 'finished');
}

function markDirty(pane) {
  document.getElementById(`${pane}-dirty`).style.display = 'inline';
}

function clearDirty() {
  document.getElementById('todo-dirty').style.display = 'none';
  document.getElementById('finished-dirty').style.display = 'none';
}

function getActiveView() {
  return focusedPane === 'todo' ? todoView : finishedView;
}

function getCursorLine(view) {
  const pos = view.state.selection.main.head;
  return view.state.doc.lineAt(pos).number - 1;
}

async function save() {
  const todo = todoView.state.doc.toString();
  const finished = finishedView.state.doc.toString();
  const msg = await invoke('save_files', { todo, finished });
  clearDirty();
  showMessage(msg);
}

async function completeItem() {
  if (focusedPane === 'todo') {
    const todo = todoView.state.doc.toString();
    const finished = finishedView.state.doc.toString();
    const cursorLine = getCursorLine(todoView);
    const result = await invoke('complete_item', { todo, finished, cursorLine });

    // Preserve cursor position as much as possible
    const cursorPos = Math.min(todoView.state.selection.main.head, result.todo.length);
    todoView.dispatch({
      changes: { from: 0, to: todoView.state.doc.length, insert: result.todo },
      selection: { anchor: cursorPos },
    });
    finishedView.dispatch({
      changes: { from: 0, to: finishedView.state.doc.length, insert: result.finished },
    });
    showMessage(result.message);
  } else {
    const finished = finishedView.state.doc.toString();
    const todo = todoView.state.doc.toString();
    const cursorLine = getCursorLine(finishedView);
    const result = await invoke('recover_item', { finished, todo, cursorLine });

    const cursorPos = Math.min(finishedView.state.selection.main.head, result.finished.length);
    todoView.dispatch({
      changes: { from: 0, to: todoView.state.doc.length, insert: result.todo },
    });
    finishedView.dispatch({
      changes: { from: 0, to: finishedView.state.doc.length, insert: result.finished },
      selection: { anchor: cursorPos },
    });
    showMessage(result.message);
  }
}

function createEditor(parent, content, pane) {
  const changeListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      markDirty(pane);
    }
    if (update.focusChanged && update.view.hasFocus) {
      focusedPane = pane;
      updateFocus();
    }
  });

  const customKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: () => { save(); return true; },
    },
    {
      key: 'Mod-Enter',
      run: () => { completeItem(); return true; },
    },
  ]);

  const state = EditorState.create({
    doc: content,
    extensions: [
      customKeymap,
      basicSetup,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      oneDark,
      changeListener,
      EditorView.lineWrapping,
    ],
  });

  return new EditorView({ state, parent });
}

// Ctrl+Tab to switch panes
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
    e.preventDefault();
    focusedPane = focusedPane === 'todo' ? 'finished' : 'todo';
    updateFocus();
    getActiveView().focus();
  }
});

async function init() {
  const files = await invoke('load_files');

  todoView = createEditor(
    document.getElementById('todo-editor'),
    files.todo,
    'todo'
  );

  finishedView = createEditor(
    document.getElementById('finished-editor'),
    files.finished,
    'finished'
  );

  focusedPane = 'todo';
  updateFocus();
  todoView.focus();
  showMessage('Ready');
}

init();
