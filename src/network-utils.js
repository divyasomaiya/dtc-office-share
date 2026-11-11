'use strict';

const os = require('os');

/**
 * Returns a list of local IPv4 network addresses available on the host machine.
 * Filters out internal loopback addresses (127.0.0.1).
 *
 * @returns {Array<{name: string, address: string, family: string, mac: string}>}
 */
function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, netInterface] of Object.entries(interfaces)) {
    if (!netInterface) continue;

    for (const item of netInterface) {
      // Check for IPv4 and non-internal (non-loopback) addresses
      const isIPv4 = item.family === 'IPv4' || item.family === 4;
      if (isIPv4 && !item.internal) {
        addresses.push({
          interface: name,
          address: item.address,
          netmask: item.netmask,
          mac: item.mac
        });
      }
    }
  }

  return addresses;
}

/**
 * Formats access URLs for display in the console and UI.
 *
 * @param {string} host Host address the server is bound to (e.g. '0.0.0.0')
 * @param {number} port Port number
 * @param {boolean} isHttps Whether server is running under HTTPS
 * @returns {Array<string>} Formatted URLs
 */
function getAccessUrls(host, port, isHttps = false) {
  const protocol = isHttps ? 'https' : 'http';
  const urls = [];

  if (host === '0.0.0.0' || host === '::') {
    urls.push(`${protocol}://localhost:${port}`);
    const localAddrs = getLocalNetworkAddresses();
    for (const addr of localAddrs) {
      urls.push(`${protocol}://${addr.address}:${port} (${addr.interface})`);
    }
  } else {
    urls.push(`${protocol}://${host}:${port}`);
  }

  return urls;
}

module.exports = {
  getLocalNetworkAddresses,
  getAccessUrls
};
