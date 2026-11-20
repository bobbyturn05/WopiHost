const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscoveryService } = require('../dist/discovery/discovery.service');

function createDiscoveryService() {
  const config = {
    getOrThrow(name) {
      return {
        'office.discoveryUrl': 'https://discovery.example.test/hosting/discovery',
        'office.discoveryZone': 'external-https',
        'office.allowedOrigins': ['https://office.example.test'],
      }[name];
    },
  };
  return new DiscoveryService({}, config);
}

const discoveryXml = `
<wopi-discovery>
  <proof-key exponent="AQAB" modulus="current-key" oldexponent="AQAB" oldmodulus="old-key" />
  <net-zone name="internal-http">
    <app name="PowerPoint">
      <action name="embedview" ext="pptx" urlsrc="http://internal.example.test/embed?" />
    </app>
  </net-zone>
  <net-zone name="external-https">
    <app name="PowerPoint">
      <action name="view" ext="pptx" urlsrc="https://office.example.test/view?" />
      <action name="embedview" ext="pptx" urlsrc="https://office.example.test/embed?" />
      <action name="edit" ext="pptx" urlsrc="https://office.example.test/edit?" />
    </app>
  </net-zone>
</wopi-discovery>`;

test('discovery selects the configured zone and prefers embedview', () => {
  const service = createDiscoveryService();
  service.parseDiscovery(discoveryXml);

  assert.equal(service.isReady, true);
  assert.equal(service.getActionUrl('PPTX', 'view'), 'https://office.example.test/embed?');
  assert.equal(service.getActionUrl('.pptx', 'edit'), 'https://office.example.test/edit?');
  assert.equal(service.getProofKeys().old.modulus, 'old-key');
});

test('discovery rejects an action outside the configured trusted origins', () => {
  const service = createDiscoveryService();
  service.parseDiscovery(discoveryXml.replaceAll('https://office.example.test/embed?', 'https://attacker.example.test/embed?'));

  assert.throws(
    () => service.getActionUrl('pptx', 'view'),
    /untrusted action URL/,
  );
});
