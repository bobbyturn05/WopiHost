const test = require('node:test');
const assert = require('node:assert/strict');
const { WopiController } = require('../dist/wopi/wopi.controller');

test('PutFile accepts an explicitly empty octet-stream body', async () => {
  let savedContent;
  const auth = { async authorize() { return { bucket: 'documents', key: 'empty.docx', mode: 'edit' }; } };
  const wopi = {
    async putFile(_access, content) { savedContent = content; return { Version: 'version-1' }; },
  };
  const controller = new WopiController(auth, wopi);
  const headers = {};
  const response = {
    statusCode: undefined,
    setHeader(name, value) { headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    end() { return this; },
  };

  await controller.putFile('a'.repeat(64), {
    headers: {
      'content-length': '0',
      'content-type': 'application/octet-stream',
    },
    body: undefined,
  }, response, 'PUT');

  assert.ok(Buffer.isBuffer(savedContent));
  assert.equal(savedContent.length, 0);
  assert.equal(response.statusCode, 200);
  assert.equal(headers['X-WOPI-ItemVersion'], 'version-1');
});
