const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

function hasId(id) {
  return new RegExp(`\\bid=["']${id}["']`).test(html);
}

function cssRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector} rule`);
  return match[1];
}

test('app page uses a dedicated standalone shell rather than website chrome', () => {
  assert.match(html, /<body\s+class="app-page">/);
  assert.match(html, /<header\s+class="app-bar"/);
  assert.match(html, />Website<\/a>/);
  assert.doesNotMatch(html, /class="site-header"|id="main-nav"|class="site-footer"/);
  assert.doesNotMatch(html, /<h1>Practice<\/h1>|class="lead"/);
  assert.match(html, /<link rel="stylesheet" href="app\.css\?v=app-shell-1">/);
});

test('direct app entry loads the service-worker registration script', () => {
  assert.match(html, /<script defer src="site\.js\?v=hamburger-1"><\/script>/);
  const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  assert.match(worker, /'site\.js\?v=hamburger-1'/);
});

test('app shell retains every functional control and output ID', () => {
  const criticalIds = [
    'main', 'program', 'level-wrap', 'level', 'day-wrap', 'day', 'loadWorkout',
    'workoutType', 'workoutTitle', 'timer', 'timerStatus', 'startPause', 'finish',
    'reset', 'exerciseList', 'rounds', 'score', 'notes', 'history', 'exportData',
    'importData'
  ];
  for (const id of criticalIds) assert.equal(hasId(id), true, `missing #${id}`);
});

test('three accessible view buttons control the Workout, History, and Setup panels', () => {
  for (const [name, panel] of [['workout', 'workout-view'], ['history', 'history-view'], ['setup', 'setup-view']]) {
    assert.match(html, new RegExp(`<button[^>]+data-app-view="${name}"[^>]+aria-controls="${panel}"[^>]+aria-pressed="${name === 'workout' ? 'true' : 'false'}"`));
    assert.match(html, new RegExp(`<section[^>]+id="${panel}"[^>]+data-view-panel="${name}"`));
  }
  assert.match(html, /<nav[^>]+aria-label="App views"/);
  assert.doesNotMatch(html, /aria-selected/);
  assert.match(html, /id="workout-view" class="[^"]*\bis-active\b[^"]*"/);
  assert.doesNotMatch(html, /<section[^>]+data-view-panel[^>]+\shidden(?:\s|>)/);
});

test('Workout view always contains pain and pre-programme medical safety guidance', () => {
  const workoutStart = html.indexOf('<section id="workout-view"');
  const workoutEnd = html.indexOf('<section id="history-view"', workoutStart);
  assert.ok(workoutStart >= 0 && workoutEnd > workoutStart, 'Workout view section must be present');
  const workoutView = html.slice(workoutStart, workoutEnd);

  assert.match(workoutView, /stop if (?:an? )?exercise causes pain/i);
  assert.match(workoutView, /consult an appropriate medical professional before starting a fitness programme/i);
  assert.match(workoutView, /class="safety-note"/);
});

test('view switching changes only panel and navigation presentation state', () => {
  assert.match(appSource, /module\.exports\s*=\s*\{\s*setActiveAppView\s*\}/);
  const { setActiveAppView } = require('../app.js');
  const buttons = ['workout', 'history', 'setup'].map(name => ({
    dataset: { appView: name },
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; }
  }));
  const panels = ['workout', 'history', 'setup'].map(name => ({
    dataset: { viewPanel: name },
    classes: new Set(name === 'workout' ? ['is-active'] : []),
    classList: {
      toggle(className, force) {
        if (force) this.owner.classes.add(className);
        else this.owner.classes.delete(className);
      },
      owner: null
    }
  }));
  for (const panel of panels) panel.classList.owner = panel;
  const fakeRoot = {
    querySelectorAll(selector) {
      if (selector === '[data-app-view]') return buttons;
      if (selector === '[data-view-panel]') return panels;
      throw new Error(`unexpected selector: ${selector}`);
    }
  };

  setActiveAppView('history', fakeRoot);

  assert.deepEqual(buttons.map(button => button.attributes['aria-pressed']), ['false', 'true', 'false']);
  assert.deepEqual(panels.map(panel => panel.classes.has('is-active')), [false, true, false]);
  const switchSource = setActiveAppView.toString();
  assert.doesNotMatch(switchSource, /\b(?:timerState|timerId|workoutSaved|current|persistenceInProgress)\s*=/);
});

test('responsive view CSS uses active classes without hidden-attribute overrides', () => {
  assert.doesNotMatch(appCss, /\[hidden\]/);
  assert.match(cssRule('.app-view'), /display:\s*none/);
  assert.match(cssRule('.app-view.is-active'), /display:\s*block/);
  assert.match(appCss, /@media \(min-width: 960px\)[\s\S]*?\.app-view\s*\{[^}]*display:\s*block/);
});

test('manifest launches the focused experience in standalone scope', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, 'app.html');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.description, /workout|timer/i);
});

test('app presentation includes mobile-safe standalone metadata and no HTML sinks', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.doesNotMatch(appSource, /innerHTML|insertAdjacentHTML/);
});

test('import control shows a visible ring when its file input is focused', () => {
  const rule = cssRule('.app-page .import-button:focus-within');
  assert.match(rule, /outline:\s*3px solid #facc15/);
  assert.match(rule, /outline-offset:\s*3px/);
});

test('focused skip link stacks above standalone header and navigation', () => {
  const skipZIndex = Number(cssRule('.app-page .skip-link:focus').match(/z-index:\s*(\d+)/)?.[1]);
  for (const selector of ['.app-bar', '.app-nav']) {
    const chromeZIndex = Number(cssRule(selector).match(/z-index:\s*(\d+)/)?.[1]);
    assert.ok(skipZIndex > chromeZIndex, `focused skip link must stack above ${selector}`);
  }
});

test('primary button background token has AA contrast against white text', () => {
  const token = cssRule('.app-page').match(/--app-green-dark:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(token, 'missing --app-green-dark color token');

  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
    const linear = channels.map(channel => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const contrastAgainstWhite = 1.05 / (luminance(token) + 0.05);

  assert.ok(contrastAgainstWhite >= 4.5, `primary button contrast is ${contrastAgainstWhite.toFixed(2)}:1`);
});

test('compact shell surfaces preserve gutters beyond horizontal safe areas', () => {
  for (const selector of ['.app-bar-inner', '.app-main', '.app-nav']) {
    const rule = cssRule(selector);
    assert.match(rule, /padding[^;]*max\([^;]*env\(safe-area-inset-left\)/, `${selector} must pad beyond the left safe area`);
    assert.match(rule, /padding[^;]*max\([^;]*env\(safe-area-inset-right\)/, `${selector} must pad beyond the right safe area`);
  }
});
