import assert from 'node:assert/strict';
import type os from 'node:os';
import { describe, it } from 'node:test';
import { lanAddresses } from './netinfo.js';

type Info = os.NetworkInterfaceInfo;
const v4 = (address: string, internal = false): Info =>
  ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '', cidr: null }) as Info;
const v6 = (address: string): Info => ({ address, family: 'IPv6', internal: false, netmask: '', mac: '', cidr: null, scopeid: 0 }) as Info;

describe('lanAddresses', () => {
  it('puts the real Wi-Fi adapter before virtual ones (typical Windows machine)', () => {
    const result = lanAddresses({
      'vEthernet (WSL)': [v4('172.28.64.1')],
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
      'Wi-Fi': [v4('192.168.1.23')],
    });
    assert.deepEqual(result, ['192.168.1.23', '172.28.64.1', '192.168.56.1']);
  });

  it('puts the real adapter before VPN/virtual ones (typical Mac)', () => {
    const result = lanAddresses({ utun3: [v4('10.8.0.2')], bridge100: [v4('192.168.64.1')], en0: [v4('192.168.1.2')] });
    assert.equal(result[0], '192.168.1.2');
  });

  it('prefers private ranges over public addresses on real adapters', () => {
    assert.deepEqual(lanAddresses({ eth0: [v4('203.0.113.9')], eth1: [v4('10.0.0.5')] }), ['10.0.0.5', '203.0.113.9']);
  });

  it('ignores loopback, link-local, IPv6 and duplicates', () => {
    const result = lanAddresses({
      lo: [v4('127.0.0.1', true)],
      eth0: [v4('169.254.10.10'), v6('fe80::1'), v4('192.168.0.9')],
      eth1: [v4('192.168.0.9')],
    });
    assert.deepEqual(result, ['192.168.0.9']);
  });

  it('returns nothing when offline', () => {
    assert.deepEqual(lanAddresses({ lo: [v4('127.0.0.1', true)] }), []);
  });
});
