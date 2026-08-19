const formatTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

export const logger = {
  info: (msg, meta = '') => {
    console.log(`\x1b[36m[${formatTimestamp()}]\x1b[0m \x1b[32mINFO\x1b[0m: ${msg}`, meta ? meta : '');
  },
  warn: (msg, meta = '') => {
    console.warn(`\x1b[36m[${formatTimestamp()}]\x1b[0m \x1b[33mWARN\x1b[0m: ${msg}`, meta ? meta : '');
  },
  error: (msg, error = '') => {
    console.error(`\x1b[36m[${formatTimestamp()}]\x1b[0m \x1b[31mERROR\x1b[0m: ${msg}`, error ? error : '');
  },
  market: (msg, meta = '') => {
    console.log(`\x1b[36m[${formatTimestamp()}]\x1b[0m \x1b[35mMARKET\x1b[0m: ${msg}`, meta ? meta : '');
  },
  alert: (msg, meta = '') => {
    console.log(`\x1b[36m[${formatTimestamp()}]\x1b[0m \x1b[31m\x1b[1mALERT\x1b[0m: ${msg}`, meta ? meta : '');
  },
  telegram: (msg, meta = '') => {
    console.log(`\x1b[36m[${formatTimestamp()}]\x1b[0m \x1b[34mTELEGRAM\x1b[0m: ${msg}`, meta ? meta : '');
  }
};
