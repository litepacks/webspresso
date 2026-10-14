/**
 * Core Mail Module
 * @module core/mail
 */

const { Mailable } = require('./mailable');
const { Mailer, createMailer } = require('./mailer');
const {
  MemoryTransport,
  ConsoleTransport,
  FileTransport,
  resolveTransport,
} = require('./transports');

module.exports = {
  Mailable,
  Mailer,
  createMailer,
  MemoryTransport,
  ConsoleTransport,
  FileTransport,
  resolveTransport,
};
