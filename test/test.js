'use strict';

const chai = require('chai');
chai.config.includeStack = true;
require('chai').should();
const expect = require('chai').expect;
const nodePath = require('path');

process.argv.push('--NODE_CONFIG={"source": "commandLine", "commandLine": true}');
process.env.NODE_CONFIG = '{"source": "env", "env": true}';

const asyncConfig = require('../');

const simpleConfigPath = nodePath.join(__dirname, 'config-simple/config.json');
const configEnvPath = nodePath.join(__dirname, 'config-env/config.json');
const configProtocolsPath = nodePath.join(__dirname, 'config-protocols/config.json');
const configSourcesPath = nodePath.join(__dirname, 'config-sources/config.json');
const configOptionsPath = nodePath.join(__dirname, 'config-order/config.json');

describe('async-config', function () {
  it('should load a simple config correctly', async function () {
    const config = await asyncConfig.load(simpleConfigPath);
    expect(config.foo).to.equal('bar');
  });

  it('should support safely reading nested properties', async function () {
    const config = await asyncConfig.load(simpleConfigPath);
    expect(config.get('foo')).to.equal('bar');
    expect(config.get('complex.hello')).to.equal('world');
    expect(config.get('invalid')).to.equal(undefined);
    expect(config.get('complex')).to.deep.equal({
      hello: 'world'
    });
    expect(config.get('complex.invalid.hello')).to.equal(undefined);
  });

  it('should support merging a production config', async function () {
    const options = { environment: 'production' };
    const config = await asyncConfig.load(configEnvPath, options);
    expect(config.test.env).to.equal('production');
  });

  it('should support normalizing prod to production', async function () {
    const options = { environment: 'prod' };
    const config = await asyncConfig.load(configEnvPath, options);
    expect(config.test.env).to.equal('production');
  });

  it('should default environment based on process.env.NODE_ENV', async function () {
    process.env.NODE_ENV = 'production';
    const config = await asyncConfig.load(configEnvPath);
    expect(config.test.env).to.equal('production');
  });

  it('should support protocol resolvers', async function () {
    const options = {
      environment: 'production',
      protocols: {
        'upperCase': function (value) {
          return value.toUpperCase();
        },
        'upperCaseAsync': function (value) {
          return new Promise((resolve) => {
            setTimeout(function () {
              resolve(value.toUpperCase());
            }, 100);
          });
        }
      }
    };

    const config = await asyncConfig.load(configProtocolsPath, options);
    expect(config.path).to.equal(__dirname);
    expect(typeof config.imported.get).to.equal('undefined'); // Imported config should not have the "get" helper
    expect(config.imported.env).to.equal('production');
    expect(config.imported.upperCase).to.equal('HELLO WORLD');
    expect(config.imported.upperCaseAsync).to.equal('HELLO WORLD');
  });

  it('should support configurable sources', async function () {
    const options = {
      environment: 'production',
      sources (sources) {
                // Add an override to the end
        sources.push({
          push: true,
          baz: 'override'
        });

        sources.unshift({
          unshift: true,
          baz: 'default'
        });
      },
      defaults: [
        nodePath.join(__dirname, 'config-sources/defaults.json')
      ],
      overrides: [
        function () {
          return new Promise((resolve) => {
            setTimeout(function () {
              resolve({
                foo: 'override',
                overrides: true
              });
            }, 100);
          });
        }
      ]
    };

    const config = await asyncConfig.load(configSourcesPath, options);
    expect(config.hello).to.equal('world');
    expect(config.defaults).to.equal(true);
    expect(config.foo).to.equal('override');
    expect(config.overrides).to.equal(true);
    expect(config.push).to.equal(true);
    expect(config.unshift).to.equal(true);
    expect(config.baz).to.equal('override');
  });

  it('should load configs in the correct order', async function () {
    var sources = null;

    var options = {
      environment: 'production',
      sources: function (_sources) {
        sources = _sources;
      }
    };

    const config = await asyncConfig.load(configOptionsPath, options);

    expect(config.default).to.equal(true);
    expect(config.local).to.equal(true);
    expect(config.env).to.equal(true);
    expect(config.commandLine).to.equal(true);
    expect(config.production).to.equal(true);

    expect(sources.length).to.equal(5);
    expect(sources[0]).to.equal(nodePath.join(__dirname, 'config-order/config.json'));
    expect(sources[1]).to.equal(nodePath.join(__dirname, 'config-order/config-production.json'));
    expect(sources[2]).to.equal(nodePath.join(__dirname, 'config-order/config-local.json'));
    expect(sources[3].source).to.equal('env');
    expect(sources[4].source).to.equal('commandLine');
  });

  it('should support a finalize function', async function () {
    var options = {
      finalize (config) {
        config.finalized = true;
        return Promise.resolve();
      }
    };

    const config = await asyncConfig.load(simpleConfigPath, options);

    expect(config.foo).to.equal('bar');
    expect(config.finalized).to.equal(true);
    expect(config.get('finalized')).to.equal(true);
  });

  it('should support a finalize function that provides a new object', async function () {
    var options = {
      finalize (config) {
        return Promise.resolve({
          finalized: true
        });
      }
    };

    const config = await asyncConfig.load(nodePath.join(__dirname, 'config-simple/config.json'), options);

    expect(config.foo).to.equal(undefined);
    expect(config.finalized).to.equal(true);
    expect(config.get('finalized')).to.equal(true);
  });
});
