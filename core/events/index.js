/**
 * Webspresso Events Subsystem - Decoupled Event & Signals Architecture
 * (AdonisJS Events & Django Signals-inspired)
 * @module core/events
 */

const { EventDispatcher, createEventDispatcher } = require('./dispatcher');
const { Signal, defineSignal } = require('./signal');
const { defineListener, loadListeners } = require('./discovery');

// Global default event dispatcher instance
const defaultDispatcher = createEventDispatcher();

module.exports = {
  EventDispatcher,
  createEventDispatcher,
  defaultDispatcher,
  events: defaultDispatcher,
  Signal,
  defineSignal,
  defineListener,
  loadListeners,
};
