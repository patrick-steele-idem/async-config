
'use strict';
var chai = require('chai');
chai.config.includeStack = true;
require('chai').should();
var expect = require('chai').expect;
var nodePath = require('path');
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
            expect(config.imported.env).to.equal('production');
            expect(config.imported.upperCase).to.equal('HELLO WORLD');
            expect(config.imported.upperCaseAsync).to.equal('HELLO WORLD');
            done();
        });
    });

});