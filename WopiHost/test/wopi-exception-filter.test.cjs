const test = require('node:test');
const assert = require('node:assert/strict');
const { ConflictException } = require('@nestjs/common');
const { WopiExceptionFilter } = require('../dist/common/filters/wopi-exception.filter');

test('WOPI lock conflicts include the current X-WOPI-Lock response header', () => {
  const headers = {};
  const response = {
    statusCode: undefined,
    body: undefined,
    setHeader(name, value) { headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
  const host = { switchToHttp: () => ({ getResponse: () => response }) };
  const filter = new WopiExceptionFilter();

  filter.catch(new ConflictException({ message: 'Lock mismatch', currentLock: 'current-lock' }), host);

  assert.equal(response.statusCode, 409);
  assert.equal(headers['X-WOPI-Lock'], 'current-lock');
});

test('WOPI lock conflicts report an empty X-WOPI-Lock when the file is unlocked', () => {
  const headers = {};
  const response = {
    statusCode: undefined,
    setHeader(name, value) { headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json() { return this; },
  };
  const host = { switchToHttp: () => ({ getResponse: () => response }) };
  const filter = new WopiExceptionFilter();

  filter.catch(new ConflictException({ message: 'Lock mismatch', currentLock: '' }), host);

  assert.equal(response.statusCode, 409);
  assert.equal(headers['X-WOPI-Lock'], '');
});
