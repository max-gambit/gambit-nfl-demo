// Playwright-backed implementation of the Anthropic `computer` tool spec.
//
// Anthropic's hosted reference implementation runs xvfb + xdotool inside a
// Docker container; for a web-only target Playwright is dramatically simpler
// and exposes the same primitives. The tool contract Claude sees is identical
// to the canonical computer-use Docker image, so the model's training transfers.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const VIEWPORT = { width: 1280, height: 800 };

/** The action union supported by Anthropic's `computer_20250124` tool. */
export type ComputerAction =
  | { action: 'screenshot' }
  | { action: 'left_click'; coordinate: [number, number] }
  | { action: 'right_click'; coordinate: [number, number] }
  | { action: 'middle_click'; coordinate: [number, number] }
  | { action: 'double_click'; coordinate: [number, number] }
  | { action: 'triple_click'; coordinate: [number, number] }
  | { action: 'mouse_move'; coordinate: [number, number] }
  | { action: 'left_click_drag'; start_coordinate: [number, number]; coordinate: [number, number] }
  | { action: 'left_mouse_down'; coordinate?: [number, number] }
  | { action: 'left_mouse_up'; coordinate?: [number, number] }
  | { action: 'type'; text: string }
  | { action: 'key'; text: string }
  | { action: 'hold_key'; text: string; duration: number }
  | { action: 'cursor_position' }
  | { action: 'scroll'; coordinate: [number, number]; scroll_direction: 'up' | 'down' | 'left' | 'right'; scroll_amount: number }
  | { action: 'wait'; duration: number };

export interface ToolOutput {
  text?: string;
  /** PNG bytes, base64-encoded — fed back to Claude as an `image` content block. */
  imageBase64?: string;
  /** Path on disk if a screenshot was captured. */
  imagePath?: string;
  isError?: boolean;
}

/**
 * Wraps a Playwright Page and exposes the computer-use action set. Each call
 * returns a ToolOutput suitable for direct conversion into a `tool_result`
 * content block.
 */
export class ComputerSession {
  private browser!: Browser;
  private context!: BrowserContext;
  private page!: Page;
  private screenshotIndex = 0;
  private screenshotsDir: string;
  private cursor: { x: number; y: number } = { x: 0, y: 0 };

  constructor(opts: { runDir: string; headless: boolean }) {
    this.screenshotsDir = path.join(opts.runDir, 'screenshots');
    this.headless = opts.headless;
  }

  private headless: boolean;

  async start(initialUrl: string): Promise<void> {
    await fs.mkdir(this.screenshotsDir, { recursive: true });
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      locale: 'en-US',
      // Allow clipboard reads (the Share button writes to it; flow 11 verifies).
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    this.page = await this.context.newPage();
    await this.page.goto(initialUrl, { waitUntil: 'domcontentloaded' });
    // Clear any persisted Zustand state so the run always starts cold.
    await this.page.evaluate(() => {
      try { localStorage.clear(); } catch { /* sandbox may block; harmless */ }
    });
    // Reload after clearing storage so the app re-mounts in blank-slate mode.
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  async stop(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }

  /** Dispatch a single action; capture screenshot if applicable. */
  async dispatch(input: ComputerAction): Promise<ToolOutput> {
    try {
      switch (input.action) {
        case 'screenshot':
          return await this.captureScreenshot();
        case 'left_click':
          await this.page.mouse.click(input.coordinate[0], input.coordinate[1]);
          this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          await this.settle();
          return await this.captureScreenshot();
        case 'right_click':
          await this.page.mouse.click(input.coordinate[0], input.coordinate[1], { button: 'right' });
          this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          await this.settle();
          return await this.captureScreenshot();
        case 'middle_click':
          await this.page.mouse.click(input.coordinate[0], input.coordinate[1], { button: 'middle' });
          this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          await this.settle();
          return await this.captureScreenshot();
        case 'double_click':
          await this.page.mouse.dblclick(input.coordinate[0], input.coordinate[1]);
          this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          await this.settle();
          return await this.captureScreenshot();
        case 'triple_click':
          await this.page.mouse.click(input.coordinate[0], input.coordinate[1], { clickCount: 3 });
          this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          await this.settle();
          return await this.captureScreenshot();
        case 'mouse_move':
          await this.page.mouse.move(input.coordinate[0], input.coordinate[1]);
          this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          return { text: `cursor at ${input.coordinate.join(',')}` };
        case 'left_click_drag':
          await this.page.mouse.move(input.start_coordinate[0], input.start_coordinate[1]);
          await this.page.mouse.down();
          await this.page.mouse.move(input.coordinate[0], input.coordinate[1]);
          await this.page.mouse.up();
          this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          await this.settle();
          return await this.captureScreenshot();
        case 'left_mouse_down':
          if (input.coordinate) {
            await this.page.mouse.move(input.coordinate[0], input.coordinate[1]);
            this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          }
          await this.page.mouse.down();
          return { text: 'mouse down' };
        case 'left_mouse_up':
          if (input.coordinate) {
            await this.page.mouse.move(input.coordinate[0], input.coordinate[1]);
            this.cursor = { x: input.coordinate[0], y: input.coordinate[1] };
          }
          await this.page.mouse.up();
          return { text: 'mouse up' };
        case 'type':
          await this.page.keyboard.type(input.text, { delay: 8 });
          await this.settle();
          return await this.captureScreenshot();
        case 'key':
          await this.pressKey(input.text);
          await this.settle();
          return await this.captureScreenshot();
        case 'hold_key':
          await this.page.keyboard.down(translateKey(input.text));
          await new Promise((r) => setTimeout(r, input.duration * 1000));
          await this.page.keyboard.up(translateKey(input.text));
          await this.settle();
          return await this.captureScreenshot();
        case 'cursor_position':
          return { text: `cursor at ${this.cursor.x},${this.cursor.y}` };
        case 'scroll': {
          await this.page.mouse.move(input.coordinate[0], input.coordinate[1]);
          const STEP = 100;
          const total = (input.scroll_amount ?? 1) * STEP;
          const dx = input.scroll_direction === 'left' ? -total : input.scroll_direction === 'right' ? total : 0;
          const dy = input.scroll_direction === 'up' ? -total : input.scroll_direction === 'down' ? total : 0;
          await this.page.mouse.wheel(dx, dy);
          await this.settle();
          return await this.captureScreenshot();
        }
        case 'wait':
          await new Promise((r) => setTimeout(r, Math.max(100, (input.duration ?? 1) * 1000)));
          return await this.captureScreenshot();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[computer] action failed:', input.action, message);
      return { text: `action failed: ${message}`, isError: true };
    }
  }

  /**
   * Press a key combination expressed in xdotool-style (e.g. "ctrl+k",
   * "Return", "cmd+shift+enter"). Translates to Playwright's KeyboardLayout.
   */
  private async pressKey(combo: string): Promise<void> {
    const translated = combo.split('+').map((s) => translateKey(s.trim())).join('+');
    await this.page.keyboard.press(translated);
  }

  /** Wait briefly for animations / network so subsequent screenshots are stable. */
  private async settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 250));
  }

  private async captureScreenshot(): Promise<ToolOutput> {
    const buf = await this.page.screenshot({ type: 'png', fullPage: false });
    const filename = `${String(this.screenshotIndex).padStart(3, '0')}.png`;
    const fullPath = path.join(this.screenshotsDir, filename);
    await fs.writeFile(fullPath, buf);
    this.screenshotIndex += 1;
    return {
      imageBase64: buf.toString('base64'),
      imagePath: `screenshots/${filename}`,
    };
  }
}

/**
 * xdotool/X11 keysyms → Playwright KeyboardLayout names. Most things map 1:1;
 * the noteworthy delta is the modifier names (`ctrl`, `cmd`, `super`).
 */
function translateKey(key: string): string {
  const lower = key.toLowerCase();
  switch (lower) {
    case 'cmd':
    case 'super':
    case 'meta':
      return 'Meta';
    case 'ctrl':
    case 'control':
      return 'Control';
    case 'alt':
    case 'option':
      return 'Alt';
    case 'shift':
      return 'Shift';
    case 'enter':
    case 'return':
      return 'Enter';
    case 'esc':
    case 'escape':
      return 'Escape';
    case 'tab':
      return 'Tab';
    case 'space':
      return ' ';
    case 'backspace':
      return 'Backspace';
    case 'delete':
      return 'Delete';
    case 'up':
      return 'ArrowUp';
    case 'down':
      return 'ArrowDown';
    case 'left':
      return 'ArrowLeft';
    case 'right':
      return 'ArrowRight';
    default:
      return key.length === 1 ? key : capitalize(key);
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
