// Mock GM APIs
global.GM_getValue = jest.fn((key, defaultVal) => defaultVal);
global.GM_setValue = jest.fn();
global.GM_xmlhttpRequest = jest.fn();
global.GM_registerMenuCommand = jest.fn();
global.GM_openInTab = jest.fn();
global.GM_deleteValue = jest.fn();

// Mock localStorage
const localStorageMock = (function() {
  let store = {};
  return {
    getItem: jest.fn(key => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn(key => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock console to avoid noise
global.console = {
  ...console,
  // log: jest.fn(), // Keep log for debugging if needed
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};
