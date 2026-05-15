'use strict';

/** @param {Record<string, unknown>} cmd */
function hasShortcutMods(cmd) {
  return !!(cmd.ctrlKey || cmd.metaKey || cmd.altKey || cmd.shiftKey);
}

/** @param {string} code */
function modifierKeyNameFromCode(code) {
  const m = {
    ShiftLeft: 'LeftShift',
    ShiftRight: 'RightShift',
    ControlLeft: 'LeftControl',
    ControlRight: 'RightControl',
    AltLeft: 'LeftAlt',
    AltRight: 'RightAlt',
    MetaLeft: 'LeftSuper',
    MetaRight: 'RightSuper',
    OSLeft: 'LeftSuper',
    OSRight: 'RightSuper',
  };
  return m[code] || null;
}

/**
 * 这些键用「按下+松开」比 `type()` 在 macOS / 企业微信等场景更可靠。
 * @param {string} code
 */
function shouldTapPhysicalKey(code) {
  const c = String(code || '');
  return (
    c === 'Enter' ||
    c === 'NumpadEnter' ||
    c === 'Escape' ||
    c === 'Tab' ||
    c === 'Backspace' ||
    c === 'Delete' ||
    c === 'Insert' ||
    c === 'PageUp' ||
    c === 'PageDown' ||
    c === 'Home' ||
    c === 'End' ||
    c === 'ArrowLeft' ||
    c === 'ArrowUp' ||
    c === 'ArrowRight' ||
    c === 'ArrowDown'
  );
}

/**
 * @param {object} keyboard
 * @param {unknown} nutKey
 * @returns {Promise<boolean>} 是否已处理
 */
async function tapPhysicalKeyIfSupported(keyboard, nutKey) {
  if (nutKey == null) return false;
  try {
    if (typeof keyboard.pressKey === 'function' && typeof keyboard.releaseKey === 'function') {
      await keyboard.pressKey(nutKey);
      await keyboard.releaseKey(nutKey);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** @param {string} code @param {object} Key */
function physicalKeyFromCode(code, Key) {
  const map = {
    Escape: 'Escape',
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12',
    Backquote: 'Grave',
    Digit1: 'Num1',
    Digit2: 'Num2',
    Digit3: 'Num3',
    Digit4: 'Num4',
    Digit5: 'Num5',
    Digit6: 'Num6',
    Digit7: 'Num7',
    Digit8: 'Num8',
    Digit9: 'Num9',
    Digit0: 'Num0',
    Minus: 'Minus',
    Equal: 'Equal',
    Backspace: 'Backspace',
    Tab: 'Tab',
    Enter: 'Return',
    NumpadEnter: 'Enter',
    Pause: 'Pause',
    CapsLock: 'CapsLock',
    Space: 'Space',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    End: 'End',
    Home: 'Home',
    ArrowLeft: 'Left',
    ArrowUp: 'Up',
    ArrowRight: 'Right',
    ArrowDown: 'Down',
    PrintScreen: 'Print',
    Insert: 'Insert',
    Delete: 'Delete',
    ContextMenu: 'Menu',
    KeyA: 'A',
    KeyB: 'B',
    KeyC: 'C',
    KeyD: 'D',
    KeyE: 'E',
    KeyF: 'F',
    KeyG: 'G',
    KeyH: 'H',
    KeyI: 'I',
    KeyJ: 'J',
    KeyK: 'K',
    KeyL: 'L',
    KeyM: 'M',
    KeyN: 'N',
    KeyO: 'O',
    KeyP: 'P',
    KeyQ: 'Q',
    KeyR: 'R',
    KeyS: 'S',
    KeyT: 'T',
    KeyU: 'U',
    KeyV: 'V',
    KeyW: 'W',
    KeyX: 'X',
    KeyY: 'Y',
    KeyZ: 'Z',
    BracketLeft: 'LeftBracket',
    BracketRight: 'RightBracket',
    Backslash: 'Backslash',
    Semicolon: 'Semicolon',
    Quote: 'Quote',
    Comma: 'Comma',
    Period: 'Period',
    Slash: 'Slash',
    NumpadDivide: 'Divide',
    NumpadMultiply: 'Multiply',
    NumpadSubtract: 'Subtract',
    NumpadAdd: 'Add',
    NumpadDecimal: 'Decimal',
    Numpad0: 'NumPad0',
    Numpad1: 'NumPad1',
    Numpad2: 'NumPad2',
    Numpad3: 'NumPad3',
    Numpad4: 'NumPad4',
    Numpad5: 'NumPad5',
    Numpad6: 'NumPad6',
    Numpad7: 'NumPad7',
    Numpad8: 'NumPad8',
    Numpad9: 'NumPad9',
  };
  const name = map[code];
  if (!name || Key[name] === undefined) return null;
  return Key[name];
}

/**
 * @param {Record<string, unknown>} cmd
 * @param {object} Key
 * @returns {unknown[]}
 */
function shortcutPrefixKeys(cmd, Key) {
  /** @type {unknown[]} */
  const keys = [];
  if (cmd.metaKey && Key.LeftSuper !== undefined) keys.push(Key.LeftSuper);
  if (cmd.ctrlKey && Key.LeftControl !== undefined) keys.push(Key.LeftControl);
  if (cmd.altKey && Key.LeftAlt !== undefined) keys.push(Key.LeftAlt);
  if (cmd.shiftKey && Key.LeftShift !== undefined) keys.push(Key.LeftShift);
  return keys;
}

/**
 * @param {string} code
 */
function isLetterOrDigitCode(code) {
  return /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code);
}

/**
 * @param {typeof import('@nut-tree-fork/nut-js')} nut
 * @param {Record<string, unknown>} cmd
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function dispatchKeyboard(nut, cmd) {
  const { keyboard, Key } = nut;

  if (cmd.type === 'text') {
    const raw = String(cmd.text ?? '');
    const text = raw.length > 8000 ? raw.slice(0, 8000) : raw;
    if (!text) return { ok: true };
    const prev = keyboard.config.autoDelayMs;
    keyboard.config.autoDelayMs = Math.min(prev > 0 ? prev : 8, 12);
    try {
      await keyboard.type(text);
    } finally {
      keyboard.config.autoDelayMs = prev;
    }
    return { ok: true };
  }

  if (cmd.type !== 'key') return { ok: false, reason: 'not-key' };

  const phase = cmd.phase === 'up' ? 'up' : 'down';
  const code = String(cmd.code || '');
  const key = String(cmd.key || '');

  const modName = modifierKeyNameFromCode(code);
  if (modName && Key[modName] !== undefined) {
    const k = Key[modName];
    if (phase === 'down') await keyboard.pressKey(k);
    else await keyboard.releaseKey(k);
    return { ok: true };
  }

  if (phase === 'up') return { ok: true };

  const nutKey = physicalKeyFromCode(code, Key);

  if (hasShortcutMods(cmd) && nutKey != null) {
    const prefix = shortcutPrefixKeys(cmd, Key);
    await keyboard.type(...prefix, nutKey);
    return { ok: true };
  }

  const prevDelay = keyboard.config.autoDelayMs;
  keyboard.config.autoDelayMs = Math.min(prevDelay > 0 ? prevDelay : 8, 12);
  try {
    if (!hasShortcutMods(cmd) && isLetterOrDigitCode(code)) {
      if (key && key !== 'Dead' && key !== 'Process' && key !== 'Unidentified') {
        await keyboard.type(key);
        return { ok: true };
      }
    }

    if (nutKey != null) {
      if (!hasShortcutMods(cmd) && shouldTapPhysicalKey(code)) {
        const okTap = await tapPhysicalKeyIfSupported(keyboard, nutKey);
        if (okTap) return { ok: true };
      }
      await keyboard.type(nutKey);
      return { ok: true };
    }

    if (key && key !== 'Dead' && key !== 'Process' && key !== 'Unidentified') {
      await keyboard.type(key);
      return { ok: true };
    }
  } finally {
    keyboard.config.autoDelayMs = prevDelay;
  }

  return { ok: false, reason: 'unmapped-key' };
}

module.exports = { dispatchKeyboard };
