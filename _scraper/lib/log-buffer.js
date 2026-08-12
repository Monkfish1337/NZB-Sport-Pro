// Live log + SSE pub/sub.
//
// Every component of the scraper appends to this buffer instead of writing
// to stdout directly. The GUI's /logs page subscribes via Server-Sent
// Events and tails the buffer in real time. New subscribers get a recent-
// history dump so they see context immediately on page load.
//
// Per-entry shape: { ts, level, category, source, message }
//   level    — info | warn | error | debug
//   category — scrape | source | system | http
//   source   — optional source name (e.g. "prowlarr")
//   message  — free text

const EventEmitter = require('events');
const config = require('../config');

class LogBuffer extends EventEmitter {
  constructor(max) {
    super();
    this.max = max || 4000;
    this.buf = [];
    this.seq = 0;
    this.setMaxListeners(0);   // unbounded SSE subscribers
  }

  append({ level, category, source, message }) {
    const entry = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      level: level || 'info',
      category: category || 'system',
      source: source || null,
      message: typeof message === 'string' ? message : String(message),
    };
    this.buf.push(entry);
    if (this.buf.length > this.max) this.buf.shift();
    this.emit('entry', entry);
    // Mirror to stdout for docker logs.
    const tag = entry.source ? '[' + entry.category + '/' + entry.source + ']' : '[' + entry.category + ']';
    const out = entry.level === 'error' ? console.error : console.log;
    out(tag + ' ' + entry.message);
    return entry;
  }

  recent(n) {
    if (!n || n <= 0) return this.buf.slice();
    return this.buf.slice(-n);
  }

  clear() {
    this.buf.length = 0;
  }

  // Convenience helpers — saves callers spelling out the object every time.
  info(category, message, source)  { return this.append({ level: 'info',  category, message, source }); }
  warn(category, message, source)  { return this.append({ level: 'warn',  category, message, source }); }
  error(category, message, source) { return this.append({ level: 'error', category, message, source }); }
  debug(category, message, source) { return this.append({ level: 'debug', category, message, source }); }
}

const log = new LogBuffer(config.logBufferMax);
module.exports = log;
