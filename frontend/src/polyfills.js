// This file is kept for backward compatibility
// Previously used polyfills have been removed as they're no longer needed
// The imports from this file remain in index.tsx for compatibility

// Polyfill for process
// window.process = require('process/browser');

// Polyfill for Buffer
window.Buffer = window.Buffer || require('buffer').Buffer;

// Polyfill for EventEmitter
window.EventEmitter = window.EventEmitter || require('events'); 