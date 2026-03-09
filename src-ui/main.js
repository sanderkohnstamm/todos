import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { keymap, drawSelection } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { palettes, applyPalette } from './themes.js';

const { invoke } = window.__TAURI__.tauri;

let todoView = null;
let finishedView = null;
let focusedPane = 'todo';
let finishedVisible = true;
let currentPalette = 0;
let statusTimeout = null;
let autoSaveTimeout = null;

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

async function save(silent) {
  const todo = todoView.state.doc.toString();
  const finished = finishedView.state.doc.toString();
  await invoke('save_files', { todo, finished });
  clearDirty();
  if (!silent) showMessage('Saved');
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(() => save(true), 1000);
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
    await save(true);
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
    await save(true);
    showMessage(result.message);
  }
}

function createEditor(parent, content, pane) {
  const changeListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      markDirty(pane);
      scheduleAutoSave();
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
      keymap.of([indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      changeListener,
      EditorView.lineWrapping,
    ],
  });

  return new EditorView({ state, parent });
}

function toggleFinishedPane() {
  finishedVisible = !finishedVisible;
  const finishedPane = document.getElementById('finished-pane');
  const divider = document.querySelector('.divider');
  if (finishedVisible) {
    finishedPane.style.display = '';
    divider.style.display = '';
    showMessage('Finished pane shown');
  } else {
    finishedPane.style.display = 'none';
    divider.style.display = 'none';
    focusedPane = 'todo';
    updateFocus();
    todoView.focus();
    showMessage('Finished pane hidden');
  }
}

function cyclePalette() {
  currentPalette = (currentPalette + 1) % palettes.length;
  const p = palettes[currentPalette];
  applyPalette(p);
  showMessage(`Theme: ${p.name}`);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
    e.preventDefault();
    if (!finishedVisible) {
      toggleFinishedPane();
      return;
    }
    focusedPane = focusedPane === 'todo' ? 'finished' : 'todo';
    updateFocus();
    getActiveView().focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleFinishedPane();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    cyclePalette();
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

  applyPalette(palettes[currentPalette]);
  focusedPane = 'todo';
  updateFocus();
  todoView.focus();
  showMessage('Ready');
}

init();
