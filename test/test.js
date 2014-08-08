
'use strict';
var chai = require('chai');
chai.config.includeStack = true;
require('chai').should();
var expect = require('chai').expect;
var nodePath = require('path');

process.argv.push('--NODE_CONFIG={"source": "commandLine", "commandLine": true}');
process.env.NODE_CONFIG='{"source": "env", "env": true}';

var asyncConfig = require('../');

describe('async-config' , function() {

    beforeEach(function(done) {
        done();
    });

    it('should load a simple config correctly', function(done) {
        asyncConfig.load(nodePath.join(__dirname, 'config-simple/config.json'), function(err, config) {
            if (err) {
                return done(err);
            }

            expect(config.foo).to.equal('bar');
            done();
        });
    });

    it('should support safely reading nested properties', function(done) {
        asyncConfig.load(nodePath.join(__dirname, 'config-simple/config.json'), function(err, config) {
            if (err) {
                return done(err);
            }

            expect(config.get('foo')).to.equal('bar');
            expect(config.get('complex.hello')).to.equal('world');
            expect(config.get('invalid')).to.equal(undefined);
            expect(config.get('complex')).to.deep.equal({
                hello: 'world'
            });
            expect(config.get('complex.invalid.hello')).to.equal(undefined);
            done();
        });
    });

    it('should support merging a production config', function(done) {
        var options = {
            environment: 'production'
        };

        asyncConfig.load(nodePath.join(__dirname, 'config-env/config.json'), options, function(err, config) {
            if (err) {
                return done(err);
            }

            expect(config.test.env).to.equal('production');
            done();
        });
    });

    it('should support normalizing prod to production', function(done) {
        var options = {
            environment: 'prod'
        };

        asyncConfig.load(nodePath.join(__dirname, 'config-env/config.json'), options, function(err, config) {
            if (err) {
                return done(err);
            }

            expect(config.test.env).to.equal('production');
            done();
        });
    });

    it('should default environment based on process.env.NODE_ENV', function(done) {
        process.env.NODE_ENV = 'production';
        asyncConfig.load(nodePath.join(__dirname, 'config-env/config.json'), function(err, config) {
            if (err) {
                return done(err);
            }

            expect(config.test.env).to.equal('production');
            done();
        });
    });

    it('should support protocol resolvers', function(done) {
        var options = {
            environment: 'production',
            protocols: {
                'upperCase': function(value) {
                    return value.toUpperCase();
                },
                'upperCaseAsync': function(value, callback) {
                    setTimeout(function() {
                        callback(null, value.toUpperCase());
                    }, 100);
                }
            }
        };

        asyncConfig.load(nodePath.join(__dirname, 'config-protocols/config.json'), options, function(err, config) {
            if (err) {
                return done(err);
            }
            expect(config.path).to.equal(__dirname);
            expect(typeof config.imported.get).to.equal('undefined'); // Imported config should not have the "get" helper
            expect(config.imported.env).to.equal('production');
            expect(config.imported.upperCase).to.equal('HELLO WORLD');
            expect(config.imported.upperCaseAsync).to.equal('HELLO WORLD');
            done();
        });
    });

    it('should support configurable sources', function(done) {
        var options = {
            environment: 'production',
            sources: function(sources) {
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
                function(callback) {
                    setTimeout(function() {
                        callback(null, {
                            foo: 'override',
                            overrides: true
                        });
                    }, 100);
                }
            ]
        };

        asyncConfig.load(nodePath.join(__dirname, 'config-sources/config.json'), options, function(err, config) {
            if (err) {
                return done(err);
            }
            expect(config.hello).to.equal('world');
            expect(config.defaults).to.equal(true);
            expect(config.foo).to.equal('override');
            expect(config.overrides).to.equal(true);
            expect(config.push).to.equal(true);
            expect(config.unshift).to.equal(true);
            expect(config.baz).to.equal('override');
            
            done();
        });
    });

    it('should load configs in the correct order', function(done) {
        var sources = null;

        var options = {
            environment: 'production',
            sources: function(_sources) {
                sources = _sources;
            }
        };

        asyncConfig.load(nodePath.join(__dirname, 'config-order/config.json'), options, function(err, config) {
            if (err) {
                return done(err);
            }
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
            done();
        });
    });

    it('should support a finalize function', function(done) {
        var options = {
            finalize: function(config, callback) {
                config.finalized = true;
                callback();
            }
        };

        asyncConfig.load(nodePath.join(__dirname, 'config-simple/config.json'), options, function(err, config) {
            if (err) {
                return done(err);
            }

            expect(config.foo).to.equal('bar');
            expect(config.finalized).to.equal(true);
            expect(config.get('finalized')).to.equal(true);
            done();
        });
    });

    it('should support a finalize function that provides a new object', function(done) {
        var options = {
            finalize: function(config, callback) {
                callback(null, {
                    finalized: true
                });
            }
        };

        asyncConfig.load(nodePath.join(__dirname, 'config-simple/config.json'), options, function(err, config) {
            if (err) {
                return done(err);
            }

            expect(config.foo).to.equal(undefined);
            expect(config.finalized).to.equal(true);
            expect(config.get('finalized')).to.equal(true);
            
            done();
        });
    });
});